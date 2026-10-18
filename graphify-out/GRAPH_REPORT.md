# Graph Report - sistema-citas  (2026-09-20)

## Corpus Check
- 53 files · ~228,409 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: (none) 1, .xml 1)

## Summary
- 282 nodes · 476 edges · 20 communities (17 shown, 3 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.86)
- Token cost: 9,200 input · 2,800 output

## Community Hubs (Navigation)
- Flujo Pagos y Emails
- Bandeja Soporte y Chatbot
- Creación de Citas
- Notificaciones y Emails
- Gestión Usuarios y Cotizaciones
- Pasarelas de Pago
- Frontend Admin y Dashboard
- Autenticación y Registro
- Disponibilidad y Google Calendar
- Chatbot IA Landing
- Login Backend y Rate Limiting
- Identidad Visual v2
- Integración Google Calendar
- WhatsApp Meta Webhook
- Identidad Visual v1
- Supabase Edge Functions
- Configuración Vercel
- Editor de Citas
- Landing Page

## God Nodes (most connected - your core abstractions)
1. `handler()` - 23 edges
2. `handler()` - 16 edges
3. `handler()` - 13 edges
4. `handler()` - 11 edges
5. `handler()` - 10 edges
6. `webpayHeaders()` - 9 edges
7. `htmlEscape()` - 9 edges
8. `handler()` - 8 edges
9. `handler()` - 8 edges
10. `handleFlowWebhook()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `cotizacion — Quotation Viewer & Acceptance` --semantically_similar_to--> `Attempo v3.0 Design System (purple/indigo palette)`  [AMBIGUOUS] [semantically similar]
  cotizacion.html → admin.html
- `Admin — Main Dashboard / Agenda View` --semantically_similar_to--> `attempo-dashboard — Analytics Dashboard`  [INFERRED] [semantically similar]
  admin.html → attempo-dashboard.html
- `attempo-booking — Public Booking Wizard` --semantically_similar_to--> `booking — Conversational Booking Interface`  [INFERRED] [semantically similar]
  attempo-booking.html → booking.html
- `booking — Conversational Booking Interface` --semantically_similar_to--> `chat-frame — Attia AI Chat Widget (iframe)`  [INFERRED] [semantically similar]
  booking.html → chat-frame.html
- `Payment Result Page — pago-exitoso` --semantically_similar_to--> `Mercado Pago Payment Result Page`  [INFERRED] [semantically similar]
  pago-exitoso.html → pago-mp.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Public Booking Pipeline: wizard → slots API → Supabase → confirmation** — attempo_booking_html_page, api_slots, supabase_backend [EXTRACTED 0.95]
- **Superadmin Access Control: accesos + sa_token + impersonation → admin panel** — accesos_html_page, sa_token_header, superadmin_impersonation, admin_html_page [EXTRACTED 0.95]
- **Patient Self-Service Flow: booking → gestionar-cita → evaluar** — attempo_booking_html_page, gestionar_cita_html_page, evaluar_html_page [INFERRED 0.85]
- **Webpay Payment Flow: Redirect Pages → /api/flow → pago-exitoso** — webpay_pagar_html_appointment_payment_redirect, webpay_plan_html_plan_payment_redirect, webpay_rec_html_reminders_payment_redirect, concept_api_flow_endpoint, pago_exitoso_html_payment_result_page [EXTRACTED 0.95]
- **Authentication & Registration — Login/Registro → API → Session Token Storage** — login_html_login_form, registro_html_registration_form, concept_api_login_endpoint, login_html_session_token_storage [EXTRACTED 0.95]
- **Legal Compliance Triad: Privacy Policy + Terms + Google Calendar Policy** — privacidad_html_privacy_policy, terminos_html_terms_of_use, privacidad_html_google_calendar_policy, concept_attempo_spa [INFERRED 0.85]

## Communities (20 total, 3 thin omitted)

### Community 0 - "Flujo Pagos y Emails"
Cohesion: 0.11
Nodes (44): BASE_URL, confirmMPPayment(), confirmMPPaymentCot(), emailConfirmadoHtml(), emailPendientePagoHtml(), emailWebpayPendienteHtml(), emitirBoletaAttempo(), FLOW_API_URL (+36 more)

### Community 1 - "Bandeja Soporte y Chatbot"
Cohesion: 0.11
Nodes (22): handler(), incUso(), verifySaToken(), verifySessionToken(), BASE_URL, generateManageToken(), handler(), ejecutarBuscarDisponibilidad() (+14 more)

### Community 2 - "Creación de Citas"
Cohesion: 0.17
Nodes (24): BASE_URL, _bookingFallback, buildPagoHtml(), decryptToken(), emailHtml(), _emailLookupFallback, emailReagendadoHtml(), flowSign() (+16 more)

### Community 3 - "Notificaciones y Emails"
Cohesion: 0.16
Nodes (22): BASE_URL, BASE_URL_EVAL, buildPagoHtml(), _buildPromoFiltroUrl(), dentroHorarioComercialStgo(), emailEvaluacionHtml(), emailHtml(), emailPromoHtml() (+14 more)

### Community 4 - "Gestión Usuarios y Cotizaciones"
Cohesion: 0.14
Nodes (20): BASE_URL, buildCotizacionEmail(), buildCotizacionPDF(), config, getClienteIdFromToken(), handler(), hashPassword(), inviteHtml() (+12 more)

### Community 5 - "Pasarelas de Pago"
Cohesion: 0.12
Nodes (22): API Endpoint /api/flow — Payment Processing Hub, Mercado Pago — Payment Gateway, Transbank Webpay Plus — Chilean Payment Gateway, Payment Result Page — pago-exitoso, Plan Payment Result Handler (tipo=plan), Webpay Appointment Payment Result Handler (tipo=webpay), Mercado Pago Payment Result Page, Mercado Pago Backend Confirm API Call (/api/flow?tipo=mp_confirm) (+14 more)

### Community 6 - "Frontend Admin y Dashboard"
Cohesion: 0.15
Nodes (17): 404 — Smart Router / Fallback Handler, Accesos — Superadmin User & Business Management, Admin — Main Dashboard / Agenda View, attempo-booking — Public Booking Wizard, attempo-dashboard — Analytics Dashboard, Attempo v3.0 Design System (purple/indigo palette), attempo_session_token — Client-side Session Security, booking — Conversational Booking Interface (+9 more)

### Community 7 - "Autenticación y Registro"
Cohesion: 0.17
Nodes (16): API Endpoint /api/login — Auth & Registration, Attempo SpA — Legal Entity (Santiago, Chile), Forgot Password Modal, Login Form — attempo, Session Token localStorage Storage (login), Google Calendar API Limited Use Policy, Privacy Policy Page — attempo, Third-Party Providers (Supabase, Vercel, Resend, Google, Anthropic) (+8 more)

### Community 8 - "Disponibilidad y Google Calendar"
Cohesion: 0.23
Nodes (13): BASE_URL, decryptToken(), _evaluarFallback, flowSign(), gcCancelarEvento(), gcGetAccessToken(), handleEvaluar(), handler() (+5 more)

### Community 9 - "Chatbot IA Landing"
Cohesion: 0.29
Nodes (8): handler(), ejecutarCapturarLeadLanding(), ejecutarHerramienta(), generarSlots(), heLanding(), incUso(), landingRateLimit, verifySessionToken()

### Community 10 - "Login Backend y Rate Limiting"
Cohesion: 0.31
Nodes (9): BASE_URL, handler(), hashPassword(), isRateLimited(), _loginFallback, registroRateLimit, scryptAsync, verifyPassword() (+1 more)

### Community 11 - "Identidad Visual v2"
Cohesion: 0.27
Nodes (10): attempo Brand Identity, Double Lowercase T Letterform (tt), attempo Logo v2 (PNG), attempo Double-T Icon Mark, Mobile App Icon Design Style, Purple-to-Blue Gradient Background, Rounded Square App Icon Shape, Slogan: Todo a Tu Tiempo (+2 more)

### Community 12 - "Integración Google Calendar"
Cohesion: 0.46
Nodes (7): decryptToken(), encryptToken(), gcBuildEvent(), gcGetAccessToken(), gcGetOrCreateCalendar(), handler(), verifySessionToken()

### Community 13 - "WhatsApp Meta Webhook"
Cohesion: 0.39
Nodes (7): BASE_URL, checkWaQuota(), config, handler(), incUso(), incWaUsados(), _saveAttempoLead()

### Community 14 - "Identidad Visual v1"
Cohesion: 0.48
Nodes (7): attempo Brand Identity, attempo Logo PNG, Purple-to-Blue Gradient Background, Rounded Square App Icon Format, SaaS Mobile App Design Style, TT Monogram Mark, White Bold Rounded Sans-Serif Typography

### Community 15 - "Supabase Edge Functions"
Cohesion: 0.33
Nodes (3): ref_https, ADMIN_TOKEN, corsHeaders

### Community 16 - "Configuración Vercel"
Cohesion: 0.50
Nodes (3): crons, headers, rewrites

## Ambiguous Edges - Review These
- `cotizacion — Quotation Viewer & Acceptance` → `Attempo v3.0 Design System (purple/indigo palette)`  [AMBIGUOUS]
  cotizacion.html · relation: semantically_similar_to

## Knowledge Gaps
- **52 isolated node(s):** `landingRateLimit`, `BASE_URL`, `BASE_URL`, `_bookingFallback`, `_gestionarFallback` (+47 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 68 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `cotizacion — Quotation Viewer & Acceptance` and `Attempo v3.0 Design System (purple/indigo palette)`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **Why does `pdfkit` connect `Gestión Usuarios y Cotizaciones` to `Notificaciones y Emails`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `attempo-booking — Public Booking Wizard` connect `Frontend Admin y Dashboard` to `Disponibilidad y Google Calendar`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **What connects `landingRateLimit`, `BASE_URL`, `BASE_URL` to the rest of the system?**
  _52 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Flujo Pagos y Emails` be split into smaller, more focused modules?**
  _Cohesion score 0.1101010101010101 - nodes in this community are weakly interconnected._
- **Should `Bandeja Soporte y Chatbot` be split into smaller, more focused modules?**
  _Cohesion score 0.11083743842364532 - nodes in this community are weakly interconnected._
- **Should `Gestión Usuarios y Cotizaciones` be split into smaller, more focused modules?**
  _Cohesion score 0.13852813852813853 - nodes in this community are weakly interconnected._