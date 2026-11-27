/**
 * dte.js — Generación y firma de documentos tributarios electrónicos (DTE) para el SII de Chile
 *
 * Proceso:
 *   1. buildDteXml()    → XML del documento sin firma
 *   2. signDte()        → Firma RSA-SHA1 del DTE con cert del contribuyente + TED con clave CAF
 *   3. wrapEnvioDte()   → Sobre EnvioDTE firmado
 *   4. sendToSii()      → Upload al SII, devuelve trackId
 */

import forge from 'node-forge';
import { create } from 'xmlbuilder2';
import crypto from 'crypto';

// ─── Constantes SII ──────────────────────────────────────────────────────────

const SII_URL_CERT = 'https://maullin.sii.cl/cgi_dte/UPL/DTEUpload';
const SII_URL_PROD = 'https://palena.sii.cl/cgi_dte/UPL/DTEUpload';

const TIPO_NOMBRES = {
  33: 'Factura Electrónica',
  34: 'Factura No Afecta o Exenta Electrónica',
  39: 'Boleta Electrónica',
  41: 'Boleta No Afecta o Exenta Electrónica',
  46: 'Factura de Compra Electrónica',
  52: 'Guía de Despacho Electrónica',
  56: 'Nota de Débito Electrónica',
  61: 'Nota de Crédito Electrónica',
  110: 'Factura de Exportación Electrónica',
  111: 'Nota de Débito de Exportación Electrónica',
  112: 'Nota de Crédito de Exportación Electrónica',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }

function formatDate(d) {
  // d puede ser string "YYYY-MM-DD" o Date
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function sha1b64(text) {
  return crypto.createHash('sha1').update(text, 'utf8').digest('base64');
}

function rsaSha1Sign(privateKeyPem, data) {
  // Usar forge (puro JS) para evitar incompatibilidades del DECODER de OpenSSL 3
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const md = forge.md.sha1.create();
  md.update(data, 'utf8');
  return forge.util.encode64(privateKey.sign(md));
}

// Normaliza XML: quita espacios entre tags manteniendo valores de elementos
function c14nXml(xml) {
  return xml.replace(/>\s+</g, '><').trim();
}

// ─── Cargar certificado PKCS#12 ──────────────────────────────────────────────

/**
 * Carga un certificado .p12/.pfx y devuelve { privateKeyPem, certPem, rut }
 * @param {Buffer|string} p12Buffer  — contenido del .p12 (Buffer o base64)
 * @param {string} password
 */
export function loadP12(p12Buffer, password) {
  const p12Der = typeof p12Buffer === 'string'
    ? forge.util.decode64(p12Buffer)
    : forge.util.createBuffer(p12Buffer).getBytes();

  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

  let privateKey = null;
  let certificate = null;

  for (const safeContent of p12.safeContents) {
    for (const safeBag of safeContent.safeBags) {
      if (safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag ||
          safeBag.type === forge.pki.oids.keyBag) {
        privateKey = safeBag.key;
      }
      if (safeBag.type === forge.pki.oids.certBag) {
        certificate = safeBag.cert;
      }
    }
  }

  if (!privateKey || !certificate) throw new Error('P12 inválido: no se encontró clave o certificado');

  const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
  const certPem = forge.pki.certificateToPem(certificate);

  // Extraer RUT del subject — SII usa distintos formatos en CN, serialNumber, UID, etc.
  let rut = null;
  const rutRegex = /(\d{1,8}-[\dkK])/i;
  for (const field of ['CN', 'serialNumber', 'UID', 'title']) {
    const val = certificate.subject.getField(field)?.value || '';
    const m = val.match(rutRegex);
    if (m) { rut = m[1].toUpperCase(); break; }
  }
  if (!rut) {
    for (const attr of certificate.subject.attributes) {
      const m = (attr.value || '').toString().match(rutRegex);
      if (m) { rut = m[1].toUpperCase(); break; }
    }
  }

  return { privateKeyPem, certPem, rut };
}

// ─── Extraer clave privada del CAF ───────────────────────────────────────────

/**
 * Parsea el XML del CAF y devuelve { cafXml, clavePrivadaPem, clavePublicaHex, tipoDoc, folioDesde, folioHasta }
 */
export function parseCaf(xmlCaf) {
  const rsask = xmlCaf.match(/<RSASK>([\s\S]*?)<\/RSASK>/)?.[1]?.trim();
  if (!rsask) throw new Error('CAF inválido: no se encontró <RSASK>');

  // El SII entrega el RSASK como PEM completo con headers BEGIN/END
  let clavePrivadaPem;
  if (rsask.includes('-----BEGIN')) {
    try {
      forge.pki.privateKeyFromPem(rsask); // validar
      clavePrivadaPem = rsask;
    } catch (e) {
      throw new Error('CAF inválido: clave privada no válida — ' + e.message);
    }
  } else {
    // Fallback: tratar como DER base64 sin headers
    const b64clean = rsask.replace(/\s+/g, '');
    const b64pad   = b64clean + '='.repeat((4 - b64clean.length % 4) % 4);
    const derBytes = forge.util.decode64(b64pad);
    try {
      const key = forge.pki.privateKeyFromAsn1(
        forge.asn1.fromDer(derBytes, { strict: false, parseAllBytes: false })
      );
      clavePrivadaPem = forge.pki.privateKeyToPem(key);
    } catch (e) {
      throw new Error('CAF inválido: no se pudo leer <RSASK> — ' + e.message);
    }
  }

  const tipoDoc    = parseInt(xmlCaf.match(/<TD>(\d+)<\/TD>/)?.[1]);
  const folioDesde = parseInt(xmlCaf.match(/<RNG>[\s\S]*?<D>(\d+)<\/D>/)?.[1]);
  const folioHasta = parseInt(xmlCaf.match(/<RNG>[\s\S]*?<H>(\d+)<\/H>/)?.[1]);

  return { cafXml: xmlCaf, clavePrivadaPem, tipoDoc, folioDesde, folioHasta };
}

// ─── Generar TED (Timbre Electrónico DTE) ────────────────────────────────────

/**
 * Genera el TED — bloque firmado con la clave del CAF que va al final del DTE
 * @param {object} params
 * @param {string} params.cafXml      — XML completo del CAF
 * @param {string} params.clavePrivadaPem — PEM de la clave privada del CAF (RSASK)
 * @param {number} params.tipoDoc
 * @param {string} params.rutEmisor   — RUT empresa: "78442211-9"
 * @param {number} params.folio
 * @param {string} params.fechaEmision — "YYYY-MM-DD"
 * @param {string} params.rutReceptor
 * @param {number} params.montoTotal
 * @param {string} params.timestampFirma — ISO datetime: "2024-01-15T10:30:00"
 */
function buildTed({ cafXml, clavePrivadaPem, tipoDoc, rutEmisor, folio, fechaEmision, rutReceptor, montoTotal, timestampFirma }) {
  // El bloque DD va dentro del TED — datos que identifican el documento
  const ddXml = `<DD><RE>${rutEmisor}</RE><TD>${tipoDoc}</TD><F>${folio}</F><FE>${fechaEmision}</FE><RR>${rutReceptor}</RR><RSR></RSR><MNT>${montoTotal}</MNT><IT1></IT1><CAF version="1.0">${cafXml.match(/<CAF[\s\S]*?<\/CAF>/)?.[0]?.replace(/^<CAF[^>]*>/, '<CAF version="1.0">') || cafXml}</CAF><TSTED>${timestampFirma}</TSTED></DD>`;

  // Solo el bloque <CAF> del XML sin el wrapper externo
  const cafBlock = xmlCaf_extractCafBlock(cafXml);
  const ddFinal = `<DD><RE>${rutEmisor}</RE><TD>${tipoDoc}</TD><F>${folio}</F><FE>${fechaEmision}</FE><RR>${rutReceptor}</RR><RSR></RSR><MNT>${montoTotal}</MNT><IT1></IT1>${cafBlock}<TSTED>${timestampFirma}</TSTED></DD>`;

  const signature = rsaSha1Sign(clavePrivadaPem, ddFinal);

  return `<TED version="1.0">${ddFinal}<FRMA algoritmo="SHA1withRSA">${signature}</FRMA></TED>`;
}

function xmlCaf_extractCafBlock(xmlCaf) {
  const match = xmlCaf.match(/(<CAF[\s\S]*?<\/CAF>)/);
  return match ? match[1] : '';
}

// ─── Construir XML del DTE ───────────────────────────────────────────────────

/**
 * Construye el XML de un DTE (sin firma RSA del documento, sin TED)
 * Devuelve el string XML listo para firmar
 */
export function buildDteXml(doc, empresa) {
  const {
    tipo_documento, folio, fecha_emision, fecha_vencimiento,
    receptor_rut, receptor_nombre, receptor_giro, receptor_direccion,
    valor_unidad, medio_pago, sucursal,
    neto, iva, exento, total,
    items, referencias,
  } = doc;

  const esExento = tipo_documento === 41 || tipo_documento === 34;
  const esBoleta = tipo_documento === 39 || tipo_documento === 41;

  // Receptor: boletas a consumidor final usan RUT 66666666-6
  const rxRut = receptor_rut || '66666666-6';
  const rxNombre = receptor_nombre || (esBoleta ? 'Consumidor Final' : '');

  // Items detail
  const detalles = (items || []).map((it, i) => {
    const lines = [`<NroLinDet>${i + 1}</NroLinDet>`];
    if (it.codigo) lines.push(`<CdgItem><TpoCodigo>INT1</TpoCodigo><VlrCodigo>${it.codigo}</VlrCodigo></CdgItem>`);
    lines.push(`<NmbItem>${escXml(it.descripcion)}</NmbItem>`);
    if (it.descuento_pct) lines.push(`<DescuentoPct>${it.descuento_pct}</DescuentoPct>`);
    if (it.descuento_monto) lines.push(`<DescuentoMonto>${it.descuento_monto}</DescuentoMonto>`);
    lines.push(`<QtyItem>${it.cantidad}</QtyItem>`);
    lines.push(`<PrcItem>${it.precio_unitario}</PrcItem>`);
    if (it.exento) lines.push(`<IndExe>1</IndExe>`);
    lines.push(`<MontoItem>${it.total_linea}</MontoItem>`);
    return `<Detalle>${lines.join('')}</Detalle>`;
  }).join('');

  // Referencias (para NC/ND)
  const refs = (referencias || []).map((r, i) => {
    return `<Referencia><NroLinRef>${i + 1}</NroLinRef><TpoDocRef>${r.tipo_doc}</TpoDocRef><FolioRef>${r.folio}</FolioRef><FchRef>${r.fecha}</FchRef><CodRef>${r.codigo || 1}</CodRef><RazonRef>${escXml(r.motivo || '')}</RazonRef></Referencia>`;
  }).join('');

  // Totales
  const totalesXml = esExento
    ? `<MntExe>${total}</MntExe><MntTotal>${total}</MntTotal>`
    : `<MntNeto>${neto}</MntNeto><TasaIVA>19</TasaIVA><IVA>${iva}</IVA>${exento ? `<MntExe>${exento}</MntExe>` : ''}<MntTotal>${total}</MntTotal>`;

  const idDoc = [
    `<TipoDTE>${tipo_documento}</TipoDTE>`,
    `<Folio>${folio}</Folio>`,
    `<FchEmis>${formatDate(fecha_emision)}</FchEmis>`,
    (!esBoleta && fecha_vencimiento) ? `<FchVenc>${formatDate(fecha_vencimiento)}</FchVenc>` : '',
    `<MntBruto>0</MntBruto>`,
    medio_pago ? `<FmaPago>${medio_pago}</FmaPago>` : '',
    `<MntCancel>0</MntCancel>`,
    `<ScdOp>0</ScdOp>`,
    `<ValorUnidadItem>${valor_unidad === 'bruto' ? 'BRUTO' : 'NETO'}</ValorUnidadItem>`,
  ].filter(Boolean).join('');

  const emisorXml = [
    `<RUTEmisor>${empresa.rut}</RUTEmisor>`,
    `<RznSoc>${escXml(empresa.razon_social)}</RznSoc>`,
    `<GiroEmis>${escXml(empresa.giro)}</GiroEmis>`,
    empresa.telefono ? `<Telefono>${empresa.telefono}</Telefono>` : '',
    `<CorreoEmisor>${empresa.email}</CorreoEmisor>`,
    empresa.acteco ? `<Acteco>${empresa.acteco}</Acteco>` : '',
    `<DirOrigen>${escXml(empresa.direccion)}</DirOrigen>`,
    `<CmnaOrigen>${escXml(empresa.comuna)}</CmnaOrigen>`,
    `<CiudadOrigen>${escXml(empresa.region)}</CiudadOrigen>`,
    sucursal !== 'CASA MATRIZ' ? `<Sucursal>${escXml(sucursal)}</Sucursal>` : '',
  ].filter(Boolean).join('');

  const receptorXml = [
    `<RUTRecep>${rxRut}</RUTRecep>`,
    `<RznSocRecep>${escXml(rxNombre)}</RznSocRecep>`,
    !esBoleta && receptor_giro ? `<GiroRecep>${escXml(receptor_giro)}</GiroRecep>` : '',
    !esBoleta && receptor_direccion ? `<DirRecep>${escXml(receptor_direccion)}</DirRecep>` : '',
  ].filter(Boolean).join('');

  const dteId = `F${folio}T${tipo_documento}`;

  return `<?xml version="1.0" encoding="ISO-8859-1"?><DTE version="1.0"><Documento ID="${dteId}"><Encabezado><IdDoc>${idDoc}</IdDoc><Emisor>${emisorXml}</Emisor><Receptor>${receptorXml}</Receptor><Totales>${totalesXml}</Totales></Encabezado>${detalles}${refs}</Documento></DTE>`;
}

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── Firmar DTE ──────────────────────────────────────────────────────────────

/**
 * Firma el DTE con el certificado del contribuyente y agrega el TED
 * @param {string} dteXml          — XML del DTE (sin firma)
 * @param {string} privateKeyPem   — clave privada del cert del contribuyente
 * @param {string} certPem         — certificado del contribuyente
 * @param {string} cafXml          — XML completo del CAF
 * @param {string} cafClavePrivPem — clave privada del CAF (RSASK)
 * @param {object} tedParams       — params para buildTed (sin cafXml/clavePrivadaPem)
 * @returns {string} XML DTE firmado con TED
 */
export function signDte(dteXml, privateKeyPem, certPem, cafXml, cafClavePrivPem, tedParams) {
  const now = new Date();
  const ts = `${formatDate(now)}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

  const ted = buildTed({
    cafXml,
    clavePrivadaPem: cafClavePrivPem,
    timestampFirma: ts,
    ...tedParams,
  });

  // Insertar TED antes del cierre </Documento>
  const dteConTed = dteXml.replace('</Documento>', `${ted}</Documento>`);

  // Extraer el contenido de <Documento ID="...">...</Documento> para calcular digest
  const docContent = dteConTed.match(/(<Documento[\s\S]*?<\/Documento>)/)?.[1];
  if (!docContent) throw new Error('No se encontró bloque <Documento>');

  const docId = dteConTed.match(/ID="([^"]+)"/)?.[1];
  const digest = sha1b64(docContent);

  // Construir el bloque SignedInfo
  const signedInfo = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#${docId}"><Transforms><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;

  const signatureValue = rsaSha1Sign(privateKeyPem, signedInfo);

  // Limpiar cert PEM (quitar headers y saltos de línea)
  const certB64 = certPem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\n/g, '');

  const signatureBlock = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfo}<SignatureValue>${signatureValue}</SignatureValue><KeyInfo><KeyValue/><X509Data><X509Certificate>${certB64}</X509Certificate></X509Data></KeyInfo></Signature>`;

  return dteConTed.replace('</DTE>', `${signatureBlock}</DTE>`);
}

// ─── Envolver en EnvioDTE y firmar el sobre ───────────────────────────────────

/**
 * Crea el sobre EnvioDTE con la firma del contribuyente
 */
export function wrapEnvioDte(dteFirmadoXml, empresa, { privateKeyPem, certPem, rutFirmante }) {
  const now = new Date();
  const ts = `${formatDate(now)}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

  const caratulaXml = `<Caratula version="1.0"><RutEmisor>${empresa.rut}</RutEmisor><RutEnvia>${rutFirmante}</RutEnvia><RutReceptor>60803000-K</RutReceptor><FchResol>${formatDate(empresa.fecha_resolucion)}</FchResol><NroResol>${empresa.numero_resolucion}</NroResol><TmstFirmaEnv>${ts}</TmstFirmaEnv></Caratula>`;

  const setDteId = `SetDoc`;
  const setDteContent = `<SetDTE ID="${setDteId}"><Caratula version="1.0"><RutEmisor>${empresa.rut}</RutEmisor><RutEnvia>${rutFirmante}</RutEnvia><RutReceptor>60803000-K</RutReceptor><FchResol>${formatDate(empresa.fecha_resolucion)}</FchResol><NroResol>${empresa.numero_resolucion}</NroResol><TmstFirmaEnv>${ts}</TmstFirmaEnv></Caratula>${dteFirmadoXml}</SetDTE>`;

  const digest = sha1b64(setDteContent);

  const signedInfo = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI="#${setDteId}"><Transforms><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;

  const signatureValue = rsaSha1Sign(privateKeyPem, signedInfo);
  const certB64 = certPem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\n/g, '');

  const firma = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfo}<SignatureValue>${signatureValue}</SignatureValue><KeyInfo><KeyValue/><X509Data><X509Certificate>${certB64}</X509Certificate></X509Data></KeyInfo></Signature>`;

  return `<?xml version="1.0" encoding="ISO-8859-1"?><EnvioDTE version="1.0" xmlns="http://www.sii.cl/SiiDte" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sii.cl/SiiDte EnvioDTE_v10.xsd">${setDteContent}${firma}</EnvioDTE>`;
}

// ─── Enviar al SII ────────────────────────────────────────────────────────────

/**
 * Obtiene el token de autenticación del SII
 */
async function getSiiToken(rutFirmante, privateKeyPem, ambiente) {
  const baseUrl = ambiente === 'produccion'
    ? 'https://palena.sii.cl'
    : 'https://maullin.sii.cl';

  const soapHdr = { 'Content-Type': 'text/xml; charset=UTF-8', 'SOAPAction': '""' };

  // Paso 1: semilla — SOAP POST a CrSeed.jws
  const semillaRes = await fetch(`${baseUrl}/DTEWS/CrSeed.jws`, {
    method: 'POST',
    headers: soapHdr,
    body: `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body><m:getSeed xmlns:m="SiiDte" soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"/></soapenv:Body></soapenv:Envelope>`,
  });
  const semillaXml = await semillaRes.text();
  // El SII puede devolver la semilla como XML directo o escapado con entidades HTML
  const semilla = semillaXml.match(/<SEMILLA>(\d+)<\/SEMILLA>/)?.[1]
    || semillaXml.match(/&lt;SEMILLA&gt;(\d+)&lt;\/SEMILLA&gt;/)?.[1];
  if (!semilla) throw new Error(`SII: no se obtuvo semilla. Respuesta: ${semillaXml.slice(0, 500)}`);

  // Paso 2: firmar semilla
  const semillaDoc = `<getToken><item><Semilla>${semilla}</Semilla></item></getToken>`;
  const firmaSemilla = rsaSha1Sign(privateKeyPem, semillaDoc);
  const semillaFirmada = `<getToken><item><Semilla>${semilla}</Semilla></item><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/></SignedInfo><SignatureValue>${firmaSemilla}</SignatureValue></Signature></getToken>`;

  // Paso 3: obtener token — SOAP POST a GetTokenFromSeed.jws
  const tokenRes = await fetch(`${baseUrl}/DTEWS/GetTokenFromSeed.jws`, {
    method: 'POST',
    headers: soapHdr,
    body: `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body><m:getToken xmlns:m="SiiDte" soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><pszXml xsi:type="xsd:string"><![CDATA[${semillaFirmada}]]></pszXml></m:getToken></soapenv:Body></soapenv:Envelope>`,
  });
  const tokenXml = await tokenRes.text();
  const token = tokenXml.match(/<TOKEN>([^<]+)<\/TOKEN>/)?.[1]
    || tokenXml.match(/&lt;TOKEN&gt;([^&]+)&lt;\/TOKEN&gt;/)?.[1];
  if (!token) throw new Error(`SII: no se obtuvo token. Respuesta: ${tokenXml.slice(0, 500)}`);

  return token;
}

/**
 * Envía el EnvioDTE al SII y devuelve el trackId
 */
export async function sendToSii(envioDteXml, empresa, rutFirmante, privateKeyPem) {
  const ambiente = empresa.ambiente || 'certificacion';
  const uploadUrl = ambiente === 'produccion' ? SII_URL_PROD : SII_URL_CERT;

  const token = await getSiiToken(rutFirmante, privateKeyPem, ambiente);

  // Multipart upload al SII
  const boundary = `----formdata-${Date.now()}`;
  const rutNum = empresa.rut.replace('-', '').slice(0, -1);
  const dv = empresa.rut.slice(-1);

  const bodyParts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="rutSender"\r\n\r\n${rutFirmante.replace('-', '').slice(0,-1)}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="dvSender"\r\n\r\n${rutFirmante.slice(-1)}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="rutCompany"\r\n\r\n${rutNum}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="dvCompany"\r\n\r\n${dv}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="envio.xml"\r\nContent-Type: text/xml\r\n\r\n${envioDteXml}`,
    `--${boundary}--`,
  ].join('\r\n');

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Cookie': `TOKEN=${token}`,
    },
    body: bodyParts,
  });

  const uploadText = await uploadRes.text();
  const trackId = uploadText.match(/<TRACKID>(\d+)<\/TRACKID>/)?.[1];
  const estado = uploadText.match(/<ESTADO>(\d+)<\/ESTADO>/)?.[1];

  if (estado !== '0' || !trackId) {
    throw new Error(`SII rechazó envío. Estado: ${estado}. Respuesta: ${uploadText.slice(0, 300)}`);
  }

  return { trackId, respuestaSii: uploadText };
}

// ─── Consultar estado en SII ─────────────────────────────────────────────────

export async function consultarEstadoSii(trackId, empresa, rutFirmante, privateKeyPem) {
  const ambiente = empresa.ambiente || 'certificacion';
  const baseUrl = ambiente === 'produccion' ? 'https://palena.sii.cl' : 'https://maullin.sii.cl';

  const token = await getSiiToken(rutFirmante, privateKeyPem, ambiente);

  const rutNum = empresa.rut.replace('-', '').slice(0, -1);
  const url = `${baseUrl}/cgi_dte/UPL/DTEUpload?rutEmisor=${rutNum}&trackId=${trackId}`;

  const r = await fetch(url, {
    headers: { Cookie: `TOKEN=${token}` },
  });
  const text = await r.text();

  const estado = text.match(/<ESTADO>([^<]+)<\/ESTADO>/)?.[1];
  const glosa = text.match(/<GLOSA>([^<]+)<\/GLOSA>/)?.[1];

  return { estado, glosa, raw: text };
}
