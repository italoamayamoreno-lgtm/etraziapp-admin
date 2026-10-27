// ═══════════════════════════════════════════════════════════════════════
// MÓDULO SPORTMATCH — Etraziapp Admin
// Administra Sports Match (proyecto Firebase "sportmatch-mvp") desde este
// panel. Los datos NO se copian: se leen y se cambian directo en Sports
// Match, así que todo se refleja al instante en la app de jugadores y
// negocios.
//
// Acceso: con la sesión de Etrazia ya iniciada, se pide a la función
// "accesoPanelEtrazia" de Sports Match una llave de administrador.
// No hay que escribir otra contraseña.
// ═══════════════════════════════════════════════════════════════════════
import { getApp, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithCustomToken, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, setDoc, updateDoc, deleteDoc, query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { DISTRITOS_LIMA } from "./distritos-lima.js";

const SM_CONFIG = {
  apiKey: "AIzaSyDcqjLDoJm8gsKI0xkW9x6jmH9G_dJzlXc",
  authDomain: "sportmatch-mvp.firebaseapp.com",
  projectId: "sportmatch-mvp",
  storageBucket: "sportmatch-mvp.firebasestorage.app",
  messagingSenderId: "52272351294",
  appId: "1:52272351294:web:833bc5a7fcfcd59444e96f"
};
const URL_ACCESO = "https://us-central1-sportmatch-mvp.cloudfunctions.net/accesoPanelEtrazia";
const URL_APP = "https://sportmatch-mvp.web.app";

const smApp = initializeApp(SM_CONFIG, "sportmatch");
const smAuth = getAuth(smApp);
const db = getFirestore(smApp);

// ── Utilidades ─────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fmt = (n) => Number(n || 0).toLocaleString("es-PE");
const soles = (n) => "S/ " + Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const ahoraLima = () => new Date(Date.now() - 5 * 3600 * 1000);
const hoyISO = () => ahoraLima().toISOString().slice(0, 10);
const mesActual = () => hoyISO().slice(0, 7);
const nombreMes = (m) => { const [a, mm] = String(m).split("-"); return `${MESES[Number(mm) - 1] || ""} ${a}`; };
const fechaCorta = (iso) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(d) ? "—" : d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" }); };
const ultimosMeses = (n) => { const b = ahoraLima(); const r = []; for (let i = 0; i < n; i++) r.push(new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() - i, 1)).toISOString().slice(0, 7)); return r; };
const aviso = (msg, tipo = "info") => (window.showToast ? window.showToast(esc(msg), tipo) : alert(msg));
const TIPOS_CLIC = [
  { clave: "whatsapp", texto: "WhatsApp" }, { clave: "llamar", texto: "Llamar" },
  { clave: "mapa", texto: "Cómo llegar" }, { clave: "armar", texto: "Armar partido" }
];
const totalClics = (f) => TIPOS_CLIC.reduce((s, t) => s + Number(f?.[t.clave] || 0), 0);
const DEPORTES_GUIA = ["Tenis", "Pádel", "Fútbol", "Básket", "Varios"];
const VISTAS = ["sm-resumen", "sm-negocios", "sm-cobros", "sm-canchas", "sm-solicitudes", "sm-usuarios"];

// ── Estado ─────────────────────────────────────────────────────────────
const E = {
  conectado: false, conectando: null, error: null, cargado: false, cargando: null,
  usuarios: [], partidos: [], grupos: [], torneos: [], canchas: [], solicitudes: [], negocios: [],
  sedes: [], pedidos: [], reservas: [], cobros: [], clicsDiarios: [], clicsMes: {},
  mesClics: mesActual(), mesCobros: mesActual(), tabNegocios: "pendiente", verHistorial: false,
  vistaActual: null, actualizado: null
};

// ── Conexión con Sports Match ──────────────────────────────────────────
function etraziaAuth() { try { return getAuth(getApp()); } catch (e) { return null; } }

async function conectar(forzar = false) {
  if (E.conectado && !forzar) return true;
  if (E.conectando) return E.conectando;
  E.conectando = (async () => {
    try {
      const etAuth = etraziaAuth();
      await etAuth?.authStateReady?.();
      const etUser = etAuth?.currentUser;
      if (!etUser) throw { tipo: "sin-sesion" };
      await smAuth.authStateReady();
      const actual = smAuth.currentUser;
      let listo = false;
      if (actual && !forzar) {
        const r = await actual.getIdTokenResult();
        listo = r.claims.etraziaAdmin === true && r.claims.correo === String(etUser.email || "").toLowerCase();
      }
      if (!listo) {
        const sesion = await etUser.getIdToken();
        let resp;
        try {
          resp = await fetch(URL_ACCESO, { method: "POST", headers: { Authorization: "Bearer " + sesion } });
        } catch (e) { throw { tipo: "sin-conexion" }; }
        const datos = await resp.json().catch(() => ({}));
        if (!resp.ok) throw { tipo: datos.error || "desconocido", correo: datos.correo, detalle: datos.detalle || `HTTP ${resp.status}` };
        await signInWithCustomToken(smAuth, datos.token);
      }
      E.conectado = true; E.error = null;
      return true;
    } catch (e) {
      console.warn("SportMatch: no se pudo conectar", e);
      E.conectado = false;
      E.error = e?.tipo ? e : { tipo: "desconocido", detalle: String(e?.message || e) };
      return false;
    } finally { E.conectando = null; }
  })();
  return E.conectando;
}

function mensajeError(err) {
  const t = err?.tipo;
  if (t === "sin-sesion") return { titulo: "Tu sesión de Etrazia no está activa", texto: "Vuelve a iniciar sesión en el panel." };
  if (t === "sin-permiso") return { titulo: "Este correo no tiene acceso a SportMatch", texto: `Entraste como ${esc(err.correo || "")}. Solo los superadmins de Etrazia autorizados pueden administrar SportMatch.` };
  if (t === "permiso-firma") return {
    titulo: "Falta un permiso de una sola vez en Google Cloud",
    texto: `Sports Match todavía no puede entregar la llave de administrador. Hay que darle un permiso en Google Cloud (se hace una sola vez):
      <ol style="margin:10px 0 0 18px;line-height:1.8">
        <li>Abre <a href="https://console.cloud.google.com/apis/library/iamcredentials.googleapis.com?project=sportmatch-mvp" target="_blank" rel="noopener">esta página</a> y presiona <b>Habilitar</b> (si dice "Administrar", ya está habilitado).</li>
        <li>Abre <a href="https://console.cloud.google.com/iam-admin/iam?project=sportmatch-mvp" target="_blank" rel="noopener">esta otra página</a>, busca la fila <b>Default compute service account</b> y presiona el lápiz ✎.</li>
        <li>Presiona <b>Agregar otro rol</b>, escribe <b>Creador de tokens de cuenta de servicio</b> (Service Account Token Creator), elígelo y presiona <b>Guardar</b>.</li>
        <li>Espera 1 minuto y presiona <b>Reintentar</b> aquí abajo.</li>
      </ol>` };
  if (t === "sin-conexion") return { titulo: "No se pudo conectar con SportMatch", texto: "Revisa tu internet y vuelve a intentarlo." };
  if (t === "sesion-invalida") return { titulo: "Tu sesión de Etrazia venció", texto: "Cierra sesión y vuelve a entrar al panel." };
  return { titulo: "No se pudo conectar con SportMatch", texto: `Si recién publicaste los cambios, espera unos minutos y reintenta.${err?.detalle ? `<div class="td-mono" style="margin-top:8px">${esc(err.detalle)}</div>` : ""}` };
}

// ── Carga de datos ─────────────────────────────────────────────────────
async function leer(nombre, consulta, fallos) {
  try { const s = await getDocs(consulta); return s.docs.map((d) => ({ id: d.id, ...d.data() })); }
  catch (e) { console.warn("SportMatch:", nombre, e); fallos.push(nombre); return []; }
}
async function leerClicsMes(mes) {
  const f = await leer("contactos del mes", query(collection(db, "clicsCanchas"), where("mes", "==", mes)), []);
  const m = {}; f.forEach((x) => { m[x.canchaId] = x; }); return m;
}

async function cargar() {
  if (E.cargando) return E.cargando;
  E.cargando = (async () => {
    const fallos = [];
    const desde = new Date(ahoraLima().getTime() - 29 * 86400000).toISOString().slice(0, 10);
    const r = await Promise.all([
      leer("usuarios", collection(db, "usuarios"), fallos),
      leer("partidos", collection(db, "partidos"), fallos),
      leer("grupos", collection(db, "grupos"), fallos),
      leer("torneos", collection(db, "torneos"), fallos),
      leer("guía de canchas", collection(db, "canchas"), fallos),
      leer("solicitudes", collection(db, "solicitudesCanchas"), fallos),
      leer("negocios", collection(db, "negocios"), fallos),
      leer("sedes", collection(db, "sedes"), fallos),
      leer("pedidos", collection(db, "pedidos"), fallos),
      leer("reservas", collection(db, "reservas"), fallos),
      leer("cobros", collection(db, "cobros"), fallos),
      leer("contactos diarios", query(collection(db, "clicsDiarios"), where("dia", ">=", desde)), fallos),
      leerClicsMes(E.mesClics)
    ]);
    [E.usuarios, E.partidos, E.grupos, E.torneos, E.canchas, E.solicitudes, E.negocios,
      E.sedes, E.pedidos, E.reservas, E.cobros, E.clicsDiarios, E.clicsMes] = r;
    E.fallos = fallos;
    E.cargado = true;
    E.actualizado = new Date();
    actualizarBadges();
  })();
  try { await E.cargando; } finally { E.cargando = null; }
}

async function recargar() {
  await cargar();
  if (E.vistaActual) pintar(E.vistaActual);
}

// ── Badges del menú ────────────────────────────────────────────────────
function actualizarBadges() {
  const negPend = E.negocios.filter((n) => (n.estado || "pendiente") === "pendiente").length;
  const solPend = E.solicitudes.filter((s) => s.estado === "pendiente").length;
  const poner = (id, n) => { const b = $(id); if (!b) return; b.textContent = n; b.style.display = n ? "" : "none"; };
  poner("badge-sportmatch", negPend + solPend);
  poner("badge-sm-negocios", negPend);
  poner("badge-sm-solicitudes", solPend);
}

// ── Entrada pública: navigate() de index.html llama a abrir(vista) ─────
async function abrir(vista) {
  if (!VISTAS.includes(vista)) return;
  E.vistaActual = vista;
  try { history.replaceState(null, "", "#" + vista); } catch (e) {}
  const cont = $("view-" + vista);
  if (!cont) return;
  if (!E.conectado) {
    cont.innerHTML = cargandoHTML("Conectando con SportMatch…");
    const ok = await conectar();
    if (!ok) { if (E.vistaActual === vista) cont.innerHTML = errorHTML(); return; }
  }
  if (!E.cargado) {
    cont.innerHTML = cargandoHTML("Cargando datos de SportMatch…");
    await cargar();
  }
  if (E.vistaActual === vista) pintar(vista);
}

function cargandoHTML(texto) {
  return `<div class="card"><div class="card-body sm-cargando"><div class="auth-loading-spinner"></div><span>${esc(texto)}</span></div></div>`;
}
function errorHTML() {
  const m = mensajeError(E.error);
  return `<div class="sm-banner sm-banner-error"><div class="sm-banner-titulo">${esc(m.titulo)}</div><div>${m.texto}</div>
    <div style="margin-top:14px"><button class="btn btn-primary btn-sm" data-sm="reintentar">Reintentar</button></div></div>`;
}

function cabecera(titulo, sub, acciones = "") {
  const hora = E.actualizado ? E.actualizado.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) : "";
  return `<div class="section-header">
    <div><div class="section-title">${titulo}</div><div class="section-sub">${sub}</div></div>
    <div class="filter-bar" style="width:auto">${acciones}
      <a class="btn btn-ghost btn-sm" href="${URL_APP}" target="_blank" rel="noopener">Abrir la app ↗</a>
      <button class="btn btn-ghost btn-sm" data-sm="recargar" title="Actualizado ${hora}">↻ Actualizar</button>
    </div></div>
    ${E.fallos?.length ? `<div class="sm-banner sm-banner-error" style="margin-bottom:16px">No se pudieron leer: ${esc(E.fallos.join(", "))}. Revisa que las reglas de seguridad de SportMatch estén publicadas.</div>` : ""}`;
}

function pintar(vista) {
  const cont = $("view-" + vista);
  if (!cont) return;
  const f = { "sm-resumen": vResumen, "sm-negocios": vNegocios, "sm-cobros": vCobros, "sm-canchas": vCanchas, "sm-solicitudes": vSolicitudes, "sm-usuarios": vUsuarios }[vista];
  cont.innerHTML = f();
  if (vista === "sm-canchas") pintarTablaCanchas();
  if (vista === "sm-usuarios") pintarTablaUsuarios();
}

// ── Gráficos simples ───────────────────────────────────────────────────
function barrasH(items, vacio = "Sin datos todavía.") {
  if (!items.length || items.every((i) => !i.valor)) return `<div class="sm-vacio">${esc(vacio)}</div>`;
  const max = Math.max(...items.map((i) => i.valor), 1);
  return `<div class="sm-barras">${items.map((i) => `<div class="sm-barra-fila" title="${esc(i.etiqueta)}: ${fmt(i.valor)}">
    <span class="sm-barra-nombre">${esc(i.etiqueta)}</span>
    <span class="sm-barra-pista"><span style="width:${(i.valor / max) * 100}%"></span></span>
    <span class="sm-barra-num">${fmt(i.valor)}</span></div>`).join("")}</div>`;
}

// ═════════════════════════ RESUMEN ═════════════════════════
function vResumen() {
  const mes = mesActual();
  const ahora = new Date();
  const hace7 = new Date(Date.now() - 7 * 86400000);
  const nuevos7 = E.usuarios.filter((u) => u.creadoEn && new Date(u.creadoEn) >= hace7).length;
  const negVer = E.negocios.filter((n) => n.estado === "verificado").length;
  const negPend = E.negocios.filter((n) => (n.estado || "pendiente") === "pendiente").length;
  const resMes = E.reservas.filter((r) => String(r.fecha).startsWith(mes) && r.origen === "app" && ["reservado", "confirmado"].includes(r.estado));
  const resConf = resMes.filter((r) => r.estado === "confirmado");
  const ventasMes = E.pedidos.filter((p) => ["confirmado", "entregado"].includes(p.estado) && p.mes === mes);
  const totalVentas = ventasMes.reduce((a, p) => a + (Number(p.total) || 0), 0);
  const activos = E.partidos.filter((p) => p.estado !== "cancelado" && p.fecha && p.hora && new Date(`${p.fecha}T${p.hora}`) >= ahora);
  const torneosAb = E.torneos.filter((t) => t.estado === "abierto").length;
  const contactosMes = E.clicsDiarios.filter((d) => String(d.dia).startsWith(mes)).reduce((s, d) => s + totalClics(d), 0);
  const solPend = E.solicitudes.filter((s) => s.estado === "pendiente").length;

  const kpi = (color, etq, valor, sub) => `<div class="stat-card ${color}"><div class="stat-label">${etq}</div><div class="stat-value">${valor}</div><div class="stat-sub">${sub}</div></div>`;

  // contactos 30 días
  const porDia = {}; E.clicsDiarios.forEach((d) => { porDia[d.dia] = totalClics(d); });
  const dias = []; for (let i = 29; i >= 0; i--) dias.push(new Date(ahoraLima().getTime() - i * 86400000).toISOString().slice(0, 10));
  const vals = dias.map((d) => porDia[d] || 0);
  const max = Math.max(...vals, 1);
  const total30 = vals.reduce((a, b) => a + b, 0);
  const etiquetaDia = (d) => { const [, m, dd] = d.split("-"); return `${Number(dd)} ${MESES[Number(m) - 1].slice(0, 3)}`; };

  const cuentaDist = {}; E.usuarios.forEach((u) => { if (u.distrito) cuentaDist[u.distrito] = (cuentaDist[u.distrito] || 0) + 1; });
  const nombreCancha = Object.fromEntries(E.canchas.map((c) => [c.id, c.n]));
  const top = Object.values(E.clicsMes || {})
    .map((f) => ({ etiqueta: nombreCancha[f.canchaId] || f.canchaId, valor: totalClics(f) }))
    .sort((a, b) => b.valor - a.valor).slice(0, 8);

  return cabecera("SportMatch · Resumen", `Cómo va la app este mes (${nombreMes(mes)}). Las cifras se leen en vivo de Sports Match.`) + `
    <div class="grid-4 mb-4">
      ${kpi("accent", "Usuarios", fmt(E.usuarios.length), `+${fmt(nuevos7)} en 7 días`)}
      ${kpi("green", "Negocios verificados", fmt(negVer), negPend ? `${negPend} por verificar` : "todo al día")}
      ${kpi("blue", "Reservas del mes", fmt(resMes.length), `${fmt(resConf.length)} con pago confirmado`)}
      ${kpi("accent", "Ventas Market del mes", soles(totalVentas), `${fmt(ventasMes.length)} pedidos confirmados`)}
    </div>
    <div class="grid-4 mb-6">
      ${kpi("blue", "Partidos activos", fmt(activos.length), `${fmt(E.partidos.filter((p) => String(p.creadoEn || "").startsWith(mes)).length)} creados este mes`)}
      ${kpi("green", "Torneos abiertos", fmt(torneosAb), `${fmt(E.torneos.length)} en total`)}
      ${kpi("accent", "Contactos a canchas", fmt(contactosMes), "desde la guía, este mes")}
      ${kpi(solPend ? "red" : "green", "Solicitudes de la guía", fmt(solPend), solPend ? "por revisar" : "todo al día")}
    </div>
    <div class="card mb-4"><div class="card-header"><div class="card-title">Contactos a canchas · últimos 30 días</div><span class="td-mono">Total ${fmt(total30)}</span></div>
      <div class="card-body">${total30 === 0 ? `<div class="sm-vacio">Todavía no hay contactos. Aparecerán cuando la gente use los botones de la guía de canchas.</div>` : `
        <div class="sm-columnas">${dias.map((d, i) => `<div class="sm-col" title="${etiquetaDia(d)}: ${fmt(vals[i])} contactos"><span style="height:${(vals[i] / max) * 100}%"></span></div>`).join("")}</div>
        <div class="sm-eje"><span>${etiquetaDia(dias[0])}</span><span>${etiquetaDia(dias[15])}</span><span>Hoy</span></div>`}
      </div></div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><div class="card-title">Canchas más contactadas · ${esc(nombreMes(E.mesClics))}</div></div><div class="card-body">${barrasH(top, "Aún no hay contactos en este mes.")}</div></div>
      <div class="card"><div class="card-header"><div class="card-title">Usuarios por distrito</div></div><div class="card-body">${barrasH(Object.entries(cuentaDist).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d, n]) => ({ etiqueta: d, valor: n })), "Todavía no hay usuarios registrados.")}</div></div>
      <div class="card"><div class="card-header"><div class="card-title">Partidos activos por deporte</div></div><div class="card-body">${barrasH(["Tenis", "Pádel", "Fútbol", "Básket"].map((d) => ({ etiqueta: d, valor: activos.filter((p) => p.deporte === d).length })), "No hay partidos activos ahora.")}</div></div>
      <div class="card"><div class="card-header"><div class="card-title">Contactos por tipo · ${esc(nombreMes(mes))}</div></div><div class="card-body">${barrasH(TIPOS_CLIC.map((t) => ({ etiqueta: t.texto, valor: E.clicsDiarios.filter((d) => String(d.dia).startsWith(mes)).reduce((s, d) => s + Number(d[t.clave] || 0), 0) })))}</div></div>
    </div>`;
}

// ═════════════════════════ NEGOCIOS ═════════════════════════
function datosMesNegocio(n, mes) {
  const plan = n.plan || {};
  const ventas = E.pedidos.filter((p) => p.negocioId === n.id && ["confirmado", "entregado"].includes(p.estado) && p.mes === mes);
  const totalVentas = ventas.reduce((a, p) => a + (Number(p.total) || 0), 0);
  const comision = Math.round(totalVentas * (Number(plan.comision) || 0)) / 100;
  const reservas = E.reservas.filter((r) => r.negocioId === n.id && String(r.fecha).startsWith(mes) && r.origen === "app" && ["reservado", "confirmado"].includes(r.estado)).length;
  return { plan, ventas: ventas.length, totalVentas, comision, reservas };
}

function vNegocios() {
  const est = (n) => n.estado || "pendiente";
  const cuenta = (e) => E.negocios.filter((n) => e === "todos" || est(n) === e).length;
  const tabs = [["pendiente", "Por verificar"], ["verificado", "Verificados"], ["rechazado", "Desactivados"], ["todos", "Todos"]];
  const lista = E.negocios.filter((n) => E.tabNegocios === "todos" || est(n) === E.tabNegocios)
    .sort((a, b) => String(b.creadoEn || "").localeCompare(String(a.creadoEn || "")));
  const mes = mesActual();
  const badge = (n) => est(n) === "verificado" ? `<span class="badge badge-green">Verificado</span>`
    : est(n) === "rechazado" ? `<span class="badge badge-red">Desactivado</span>` : `<span class="badge badge-yellow">Por verificar</span>`;

  return cabecera("SportMatch · Negocios", "Clubes y tiendas que se registraron en \"Tengo un negocio\". Llámalos para verificar sus datos antes de activarlos: solo los verificados aparecen para los jugadores.") + `
    <div class="crm-tabs">${tabs.map(([k, l]) => `<button class="crm-tab ${E.tabNegocios === k ? "active" : ""}" data-sm="tab-negocios" data-tab="${k}">${l} <span class="crm-count">${cuenta(k)}</span></button>`).join("")}</div>
    ${lista.length ? `<div class="sm-grid-negocios">${lista.map((n) => {
      const d = datosMesNegocio(n, mes);
      const sedes = E.sedes.filter((s) => s.negocioId === n.id).length;
      return `<div class="card sm-negocio" data-negocio="${esc(n.id)}">
        <div class="card-header"><div class="card-title">${esc(n.nombre || "Sin nombre")}</div>${badge(n)}</div>
        <div class="card-body">
          <div class="crm-kv"><span>Tipo</span><b>${esc(n.tipo || "—")}${(n.deportes || []).length ? " · " + esc(n.deportes.join(", ")) : ""}</b></div>
          <div class="crm-kv"><span>Ubicación</span><b>${esc(n.distrito || "—")} · ${esc(n.direccion || "")}</b></div>
          <div class="crm-kv"><span>Responsable</span><b>${esc(n.responsable || "—")}</b></div>
          <div class="crm-kv"><span>WhatsApp</span><b>${n.telefono ? `<a href="https://wa.me/51${esc(String(n.telefono).replace(/\D/g, "").slice(-9))}" target="_blank" rel="noopener">${esc(n.telefono)}</a>` : "—"}</b></div>
          <div class="crm-kv"><span>Correo · RUC</span><b>${esc(n.correo || "—")} · ${esc(n.ruc || "—")}</b></div>
          <div class="crm-kv"><span>Registrado</span><b>${fechaCorta(n.creadoEn)}${n.revisadoEn ? ` · revisado ${fechaCorta(n.revisadoEn)}` : ""}</b></div>
          <div class="crm-kv"><span>Este mes</span><b>${fmt(sedes)} sedes · ${fmt(d.reservas)} reservas · ${soles(d.totalVentas)} en Market</b></div>
          <div class="sm-plan">
            <div class="form-label" style="margin:14px 0 8px">Plan del negocio</div>
            <div class="sm-plan-campos">
              <label><span>Monto inicial (S/)</span><input type="number" min="0" step="1" data-plan="setup" value="${esc(d.plan.setup ?? "")}" placeholder="0"></label>
              <label><span>Membresía mensual (S/)</span><input type="number" min="0" step="1" data-plan="membresia" value="${esc(d.plan.membresia ?? "")}" placeholder="0"></label>
              <label><span>% de ventas Market</span><input type="number" min="0" max="100" step="0.5" data-plan="comision" value="${esc(d.plan.comision ?? "")}" placeholder="0"></label>
            </div>
          </div>
          <div class="sm-acciones">
            <button class="btn btn-ghost btn-sm" data-sm="guardar-plan" data-id="${esc(n.id)}">Guardar plan</button>
            ${est(n) !== "verificado" ? `<button class="btn btn-green btn-sm" data-sm="estado-negocio" data-estado="verificado" data-id="${esc(n.id)}">✓ Verificar</button>` : ""}
            ${est(n) !== "rechazado" ? `<button class="btn btn-danger btn-sm" data-sm="estado-negocio" data-estado="rechazado" data-id="${esc(n.id)}">${est(n) === "verificado" ? "Desactivar" : "Rechazar"}</button>` : ""}
          </div>
        </div></div>`;
    }).join("")}</div>` : `<div class="card"><div class="empty-state"><h3>Nada por aquí</h3><p>${E.tabNegocios === "pendiente" ? "No hay negocios esperando verificación." : "Todavía no hay negocios en este grupo."}</p></div></div>`}`;
}

async function guardarPlan(id, boton) {
  const tarjeta = boton.closest("[data-negocio]");
  const plan = {};
  tarjeta.querySelectorAll("[data-plan]").forEach((i) => { plan[i.dataset.plan] = i.value === "" ? null : Number(i.value); });
  if (plan.comision != null && (plan.comision < 0 || plan.comision > 100)) { aviso("El % de ventas debe estar entre 0 y 100.", "error"); return; }
  boton.disabled = true;
  try {
    await updateDoc(doc(db, "negocios", id), { plan, revisadoEn: new Date().toISOString() });
    const n = E.negocios.find((x) => x.id === id); if (n) n.plan = plan;
    aviso("Plan guardado.", "success");
  } catch (e) { console.error(e); aviso("No se pudo guardar el plan.", "error"); }
  boton.disabled = false;
}

async function cambiarEstadoNegocio(id, nuevo) {
  const n = E.negocios.find((x) => x.id === id);
  const ok = await confirmar(nuevo === "verificado"
    ? `¿Verificar a <b>${esc(n?.nombre)}</b>?<br><span class="td-mono">Sus sedes y productos aparecerán para los jugadores.</span>`
    : `¿Desactivar a <b>${esc(n?.nombre)}</b>?<br><span class="td-mono">Sus sedes y productos dejarán de verse en la app.</span>`,
    nuevo === "verificado" ? "Verificar" : "Desactivar", nuevo !== "verificado");
  if (!ok) return;
  try {
    const ahora = new Date().toISOString();
    const cambios = { estado: nuevo, revisadoEn: ahora };
    if (nuevo === "verificado" && !n?.verificadoEn) cambios.verificadoEn = ahora;
    await updateDoc(doc(db, "negocios", id), cambios);
    const visible = nuevo === "verificado";
    const [sedes, productos] = await Promise.all([
      getDocs(query(collection(db, "sedes"), where("negocioId", "==", id))),
      getDocs(query(collection(db, "productos"), where("negocioId", "==", id)))
    ]);
    if (!sedes.empty || !productos.empty) {
      const lote = writeBatch(db);
      sedes.forEach((d) => lote.update(d.ref, { visible }));
      productos.forEach((d) => lote.update(d.ref, { visible }));
      await lote.commit();
    }
    if (n) Object.assign(n, cambios);
    E.sedes.forEach((s) => { if (s.negocioId === id) s.visible = visible; });
    aviso(visible ? "Negocio verificado: ya aparece para los jugadores." : "Negocio desactivado.", "success");
    actualizarBadges();
    pintar("sm-negocios");
  } catch (e) { console.error(e); aviso("No se pudo actualizar el negocio.", "error"); }
}

// ═════════════════════════ COBROS ═════════════════════════
function filasCobros(mes) {
  const finMes = mes + "-31";
  return E.negocios
    .filter((n) => n.estado === "verificado" && String(n.verificadoEn || n.creadoEn || "").slice(0, 10) <= finMes)
    .map((n) => {
      const d = datosMesNegocio(n, mes);
      const registro = E.cobros.find((c) => c.id === `${n.id}_${mes}`);
      const setupCobradoAntes = E.cobros.some((c) => c.negocioId === n.id && c.mes !== mes && Number(c.setup) > 0);
      const setup = registro ? Number(registro.setup || 0) : (setupCobradoAntes ? 0 : Number(d.plan.setup) || 0);
      const membresia = registro ? Number(registro.membresia || 0) : Number(d.plan.membresia) || 0;
      const comision = registro ? Number(registro.comision || 0) : d.comision;
      const total = registro ? Number(registro.total || 0) : Math.round((setup + membresia + comision) * 100) / 100;
      return { n, d, registro, setup, membresia, comision, total, ventas: registro ? Number(registro.ventas || 0) : d.totalVentas, pct: registro ? registro.comisionPct : d.plan.comision };
    })
    .sort((a, b) => (a.registro ? 1 : 0) - (b.registro ? 1 : 0) || b.total - a.total);
}

function vCobros() {
  const mes = E.mesCobros;
  const filas = filasCobros(mes);
  const porCobrar = filas.filter((f) => !f.registro).reduce((a, f) => a + f.total, 0);
  const cobrado = filas.filter((f) => f.registro).reduce((a, f) => a + f.total, 0);
  const sinPlan = filas.filter((f) => !f.n.plan || (!f.n.plan.membresia && !f.n.plan.setup && !f.n.plan.comision)).length;
  const sel = `<select data-sm="mes-cobros" style="width:auto">${ultimosMeses(12).map((m) => `<option value="${m}" ${m === mes ? "selected" : ""}>${esc(nombreMes(m))}</option>`).join("")}</select>`;

  return cabecera("SportMatch · Cobros", "Lo que cada negocio verificado debe pagar en el mes: monto inicial (solo una vez), membresía y % de sus ventas confirmadas en el Market. Las reservas de cancha no pagan comisión por ahora.", sel +
      `<button class="btn btn-ghost btn-sm" data-sm="csv-cobros">⬇ Descargar Excel</button>`) + `
    <div class="grid-3 mb-4">
      <div class="stat-card accent"><div class="stat-label">Por cobrar</div><div class="stat-value">${soles(porCobrar)}</div><div class="stat-sub">${fmt(filas.filter((f) => !f.registro).length)} negocios</div></div>
      <div class="stat-card green"><div class="stat-label">Cobrado</div><div class="stat-value">${soles(cobrado)}</div><div class="stat-sub">${fmt(filas.filter((f) => f.registro).length)} negocios</div></div>
      <div class="stat-card blue"><div class="stat-label">Total del mes</div><div class="stat-value">${soles(porCobrar + cobrado)}</div><div class="stat-sub">${esc(nombreMes(mes))}</div></div>
    </div>
    ${sinPlan ? `<div class="sm-banner mb-4">${fmt(sinPlan)} negocio(s) verificados todavía no tienen plan. Configúralo en <a href="#" data-sm="ir" data-vista="sm-negocios">Negocios</a>.</div>` : ""}
    <div class="card"><div class="table-wrap">
      ${filas.length ? `<table><thead><tr><th>Negocio</th><th>Monto inicial</th><th>Membresía</th><th>Ventas Market</th><th>Comisión</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>
      ${filas.map((f) => `<tr>
        <td class="td-name">${esc(f.n.nombre)}<div class="td-mono">${esc(f.n.distrito || "")}</div></td>
        <td class="td-mono">${f.setup ? soles(f.setup) : "—"}</td>
        <td class="td-mono">${soles(f.membresia)}</td>
        <td class="td-mono">${soles(f.ventas)}</td>
        <td class="td-mono">${soles(f.comision)}${f.pct ? ` <span style="color:var(--text2)">(${esc(f.pct)}%)</span>` : ""}</td>
        <td class="td-name">${soles(f.total)}</td>
        <td>${f.registro ? `<span class="badge badge-green">Cobrado</span><div class="td-mono">${fechaCorta(f.registro.cobradoEn)}</div>` : `<span class="badge badge-yellow">Pendiente</span>`}</td>
        <td style="text-align:right;white-space:nowrap">${f.registro
          ? `<button class="btn btn-ghost btn-sm" data-sm="deshacer-cobro" data-id="${esc(f.registro.id)}">Deshacer</button>`
          : `<button class="btn btn-green btn-sm" data-sm="marcar-cobro" data-id="${esc(f.n.id)}" ${f.total > 0 ? "" : "disabled title='No hay monto por cobrar'"}>Marcar cobrado</button>`}</td>
      </tr>`).join("")}</tbody></table>` : `<div class="empty-state"><h3>Sin cobros este mes</h3><p>Aquí aparecerán los negocios verificados.</p></div>`}
    </div></div>
    <p class="section-sub" style="margin-top:12px">Al marcar "Cobrado" se guarda una foto de los montos de ese momento. La boleta o factura se emite desde SUNAT y la registras en Facturación.</p>`;
}

async function marcarCobro(negocioId, boton) {
  const mes = E.mesCobros;
  const f = filasCobros(mes).find((x) => x.n.id === negocioId);
  if (!f) return;
  const ok = await confirmar(`¿Marcar como cobrado <b>${soles(f.total)}</b> a <b>${esc(f.n.nombre)}</b> por ${esc(nombreMes(mes))}?`, "Marcar cobrado");
  if (!ok) return;
  boton.disabled = true;
  const id = `${negocioId}_${mes}`;
  const datos = {
    negocioId, negocioNombre: f.n.nombre || "", mes, setup: f.setup, membresia: f.membresia,
    ventas: f.ventas, comisionPct: Number(f.pct) || 0, comision: f.comision, total: f.total,
    estado: "cobrado", cobradoEn: new Date().toISOString()
  };
  try {
    await setDoc(doc(db, "cobros", id), datos);
    E.cobros.push({ id, ...datos });
    aviso("Cobro registrado.", "success");
    pintar("sm-cobros");
  } catch (e) { console.error(e); aviso("No se pudo registrar el cobro.", "error"); boton.disabled = false; }
}

async function deshacerCobro(id) {
  const ok = await confirmar("¿Deshacer este cobro? Volverá a quedar como pendiente.", "Deshacer", true);
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "cobros", id));
    E.cobros = E.cobros.filter((c) => c.id !== id);
    aviso("Cobro deshecho.", "success");
    pintar("sm-cobros");
  } catch (e) { console.error(e); aviso("No se pudo deshacer.", "error"); }
}

function descargarCSV(nombre, cab, filas) {
  const celda = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lineas = [cab.map(celda).join(";")].concat(filas.map((f) => f.map(celda).join(";")));
  const blob = new Blob(["﻿" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ═════════════════════════ GUÍA DE CANCHAS ═════════════════════════
function vCanchas() {
  const distritos = [...new Set(E.canchas.map((c) => c.d).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  return cabecera("SportMatch · Guía de canchas", "La guía pública de canchas de Lima (sportmatch › Canchas). Lo que edites aquí se ve al instante en la app.",
      `<button class="btn btn-ghost btn-sm" data-sm="csv-canchas">⬇ Descargar Excel</button><button class="btn btn-primary btn-sm" data-sm="nueva-cancha">+ Nueva cancha</button>`) + `
    <div class="filter-bar mb-4">
      <div class="search-wrap"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="search-input" id="smFBuscar" type="search" placeholder="Buscar por nombre o dirección"></div>
      <select id="smFDeporte" style="width:auto"><option value="">Todos los deportes</option>${DEPORTES_GUIA.map((d) => `<option>${d}</option>`).join("")}</select>
      <select id="smFDistrito" style="width:auto"><option value="">Todos los distritos</option>${distritos.map((d) => `<option>${esc(d)}</option>`).join("")}</select>
      <select id="smFEstado" style="width:auto">
        <option value="">Todos los estados</option><option value="activas">Visibles en la guía</option><option value="ocultas">Ocultas</option>
        <option value="verificadas">Verificadas</option><option value="sinverificar">Sin verificar</option><option value="destacadas">Destacadas</option></select>
      <select id="smFMes" style="width:auto">${ultimosMeses(12).map((m) => `<option value="${m}" ${m === E.mesClics ? "selected" : ""}>Contactos de ${esc(nombreMes(m))}</option>`).join("")}</select>
    </div>
    <div class="section-sub mb-4" id="smResumenCanchas"></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Cancha</th><th>Distrito</th><th>Estado</th><th>Contactos del mes</th><th></th></tr></thead>
      <tbody id="smTablaCanchas"></tbody></table></div></div>`;
}

function canchasFiltradas() {
  const t = norm($("smFBuscar")?.value.trim());
  const dep = $("smFDeporte")?.value, dis = $("smFDistrito")?.value, est = $("smFEstado")?.value;
  return E.canchas.filter((c) =>
    (!t || norm(`${c.n} ${c.a} ${c.d}`).includes(t)) && (!dep || c.s === dep) && (!dis || c.d === dis) &&
    (!est || (est === "activas" && c.activa !== false) || (est === "ocultas" && c.activa === false) ||
      (est === "verificadas" && c.verificada) || (est === "sinverificar" && !c.verificada) || (est === "destacadas" && c.destacada))
  ).sort((a, b) => totalClics(E.clicsMes[b.id]) - totalClics(E.clicsMes[a.id]) || String(a.n).localeCompare(String(b.n), "es"));
}

function pintarTablaCanchas() {
  const tb = $("smTablaCanchas"); if (!tb) return;
  const filas = canchasFiltradas();
  const totalMes = filas.reduce((s, c) => s + totalClics(E.clicsMes[c.id]), 0);
  $("smResumenCanchas").textContent = `${fmt(filas.length)} canchas · ${fmt(totalMes)} contactos en ${nombreMes(E.mesClics)}`;
  tb.innerHTML = filas.length ? filas.map((c) => {
    const cl = E.clicsMes[c.id] || {};
    const sellos = (c.activa === false ? `<span class="badge badge-red">Oculta</span> ` : "") +
      (c.destacada ? `<span class="badge badge-accent">Destacada</span> ` : "") +
      (c.verificada ? `<span class="badge badge-green">Verificada</span> ` : `<span class="badge badge-yellow">Sin verificar</span> `) +
      (c.autorizo ? `<span class="badge badge-blue">Autorizó</span>` : "");
    return `<tr>
      <td><div class="td-name">${esc(c.n)}</div><div class="td-mono">${esc(c.s)} · ${esc(c.a)}${(c.t || []).length ? " · " + esc(c.t.join(" / ")) : ""}</div></td>
      <td>${esc(c.d)}</td>
      <td><div class="sm-sellos">${sellos}</div></td>
      <td><b>${fmt(totalClics(cl))}</b><div class="td-mono">${TIPOS_CLIC.map((t) => `${t.texto} ${fmt(cl[t.clave])}`).join(" · ")}</div></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-sm="reporte-cancha" data-id="${esc(c.id)}">Reporte</button>
        <button class="btn btn-ghost btn-sm" data-sm="editar-cancha" data-id="${esc(c.id)}">Editar</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="5"><div class="sm-vacio">${E.canchas.length ? "No hay canchas con esos filtros." : "La guía todavía no tiene canchas en la base de datos."}</div></td></tr>`;
}

const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);

function abrirEditorCancha(cancha, solicitud = null) {
  const c = cancha || {
    s: solicitud && DEPORTES_GUIA.includes(solicitud.deporte) ? solicitud.deporte : "Tenis",
    n: solicitud?.nombre || "", d: solicitud?.distrito || "", a: solicitud?.direccion || "",
    t: solicitud?.telefono ? [solicitud.telefono] : [], x: "",
    activa: true, verificada: !!solicitud, autorizo: !!solicitud?.autoriza, destacada: false,
    notas: solicitud ? `Registrada por ${solicitud.contacto || "—"} el ${fechaCorta(solicitud.creadoEn)} desde el formulario de la guía.` : ""
  };
  const distritos = !c.d || DISTRITOS_LIMA.includes(c.d) ? DISTRITOS_LIMA : [c.d, ...DISTRITOS_LIMA];
  const titulo = solicitud ? "Aprobar solicitud" : cancha ? "Editar cancha" : "Nueva cancha";
  const check = (id, val, txt, sub) => `<label class="sm-check"><input type="checkbox" id="${id}" ${val ? "checked" : ""}><span><b>${txt}</b><small>${sub}</small></span></label>`;
  modal(titulo, `
    ${solicitud ? `<div class="sm-banner mb-4">Revisa y corrige los datos antes de publicar. Al guardar, la cancha aparece en la guía.</div>` : ""}
    <div class="form-row">
      <div class="form-group"><label class="form-label">Deporte</label><select id="ecDeporte">${DEPORTES_GUIA.map((d) => `<option ${d === c.s ? "selected" : ""}>${d}</option>`).join("")}</select></div>
      <div class="form-group"><label class="form-label">Distrito</label><select id="ecDistrito"><option value="">Selecciona</option>${distritos.map((d) => `<option ${d === c.d ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></div>
    </div>
    <div class="form-group"><label class="form-label">Nombre</label><input id="ecNombre" maxlength="90" value="${esc(c.n)}"></div>
    <div class="form-group"><label class="form-label">Dirección</label><input id="ecDireccion" maxlength="160" value="${esc(c.a)}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Teléfonos (separa con /)</label><input id="ecTelefonos" maxlength="120" value="${esc((c.t || []).join(" / "))}" placeholder="987 654 321 / (01) 234-5678"></div>
      <div class="form-group"><label class="form-label">Detalle (opcional)</label><input id="ecDetalle" maxlength="60" value="${esc(c.x || "")}" placeholder="Ej. Sintética, Fútbol 7"></div>
    </div>
    <div class="sm-checks">
      ${check("ecActiva", c.activa !== false, "Visible en la guía", "Desmárcala para ocultarla sin borrarla.")}
      ${check("ecVerificada", c.verificada, "Verificada", "Confirmaste los datos con la cancha.")}
      ${check("ecAutorizo", c.autorizo, "Autorizó aparecer", "Te dio permiso para publicar sus datos.")}
      ${check("ecDestacada", c.destacada, "Destacada", "Sale primero en su deporte y distrito.")}
    </div>
    <div class="form-group" style="margin-top:14px"><label class="form-label">Notas internas (no se publican)</label><textarea id="ecNotas" rows="3" maxlength="600">${esc(c.notas || "")}</textarea></div>
    <div class="login-err" id="ecError"></div>`,
  `<button class="btn btn-ghost" data-sm="cerrar-modal">Cancelar</button><button class="btn btn-primary" id="ecGuardar">${solicitud ? "Aprobar y publicar" : "Guardar"}</button>`);

  $("ecGuardar").addEventListener("click", async () => {
    const datos = {
      s: $("ecDeporte").value, n: $("ecNombre").value.trim(), d: $("ecDistrito").value, a: $("ecDireccion").value.trim(),
      t: $("ecTelefonos").value.split("/").map((x) => x.trim()).filter(Boolean), x: $("ecDetalle").value.trim(),
      activa: $("ecActiva").checked, verificada: $("ecVerificada").checked, autorizo: $("ecAutorizo").checked,
      destacada: $("ecDestacada").checked, notas: $("ecNotas").value.trim(), actualizadoEn: new Date().toISOString()
    };
    if (!datos.n || !datos.d || !datos.a) { $("ecError").textContent = "Completa nombre, distrito y dirección."; return; }
    if (datos.verificada && !c.verificada) datos.verificadaEn = datos.actualizadoEn;
    if (!datos.verificada) datos.verificadaEn = null;
    $("ecGuardar").disabled = true;
    try {
      if (cancha) {
        await setDoc(doc(db, "canchas", cancha.id), datos, { merge: true });
        Object.assign(cancha, datos);
      } else {
        const id = `${slug(`${datos.s}-${datos.n}-${datos.d}`)}-${Date.now().toString(36)}`;
        const nueva = { ...datos, orden: 10000, creadoEn: datos.actualizadoEn, origen: solicitud ? "formulario de la guía" : "creada en el panel" };
        await setDoc(doc(db, "canchas", id), nueva);
        E.canchas.push({ id, ...nueva });
        if (solicitud) {
          await updateDoc(doc(db, "solicitudesCanchas", solicitud.id), { estado: "aprobada", canchaId: id, revisadoEn: datos.actualizadoEn });
          solicitud.estado = "aprobada"; solicitud.canchaId = id;
        }
      }
      cerrarModal();
      aviso(solicitud ? "Solicitud aprobada y publicada." : "Cancha guardada.", "success");
      actualizarBadges();
      pintar(E.vistaActual);
    } catch (e) {
      console.error(e);
      $("ecGuardar").disabled = false;
      $("ecError").textContent = "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.";
    }
  });
}

async function abrirReporte(c) {
  modal(`Reporte · ${esc(c.n)}`, `<div class="section-sub mb-4">${esc(c.s)} · ${esc(c.d)}</div><div id="smCuerpoReporte">${cargandoHTML("Cargando…")}</div>`,
    `<button class="btn btn-ghost" data-sm="cerrar-modal">Cerrar</button>`, 640);
  const filas = (await leer("reporte", query(collection(db, "clicsCanchas"), where("canchaId", "==", c.id)), []))
    .sort((a, b) => String(b.mes).localeCompare(String(a.mes))).slice(0, 12);
  const cuerpo = $("smCuerpoReporte"); if (!cuerpo) return;
  if (!filas.length) { cuerpo.innerHTML = `<div class="sm-vacio">Esta cancha todavía no registra contactos desde la guía.</div>`; return; }
  const u = filas[0];
  const mensaje = `Hola, te escribo de Sports Match, la guía de canchas de Lima.
En ${nombreMes(u.mes)}, ${c.n} recibió ${fmt(totalClics(u))} contactos de jugadores desde nuestra guía:
• ${fmt(u.whatsapp)} mensajes de WhatsApp
• ${fmt(u.llamar)} llamadas
• ${fmt(u.mapa)} búsquedas de cómo llegar
• ${fmt(u.armar)} partidos armados en tu cancha
¿Te gustaría aparecer como cancha Destacada o recibir reservas directo en la app?`;
  cuerpo.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Mes</th>${TIPOS_CLIC.map((t) => `<th>${t.texto}</th>`).join("")}<th>Total</th></tr></thead>
    <tbody>${filas.map((f) => `<tr><td class="td-name">${esc(nombreMes(f.mes))}</td>${TIPOS_CLIC.map((t) => `<td class="td-mono">${fmt(f[t.clave])}</td>`).join("")}<td class="td-name">${fmt(totalClics(f))}</td></tr>`).join("")}</tbody></table></div>
    <div class="form-label" style="margin-top:18px">Mensaje listo para enviarle a la cancha</div>
    <div class="sm-mensaje">${esc(mensaje)}</div>
    <button class="btn btn-ghost btn-sm" style="margin-top:10px" id="smCopiarReporte">Copiar mensaje</button>`;
  $("smCopiarReporte").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(mensaje); aviso("Mensaje copiado.", "success"); } catch (e) { aviso("No se pudo copiar; selecciónalo a mano.", "error"); }
  });
}

// ═════════════════════════ SOLICITUDES ═════════════════════════
function vSolicitudes() {
  const pend = E.solicitudes.filter((s) => s.estado === "pendiente");
  const lista = (E.verHistorial ? E.solicitudes : pend).slice().sort((a, b) => String(b.creadoEn).localeCompare(String(a.creadoEn)));
  return cabecera("SportMatch · Solicitudes", "Canchas que pidieron aparecer en la guía desde el formulario \"Registrar mi cancha\".",
      `<button class="btn btn-ghost btn-sm" data-sm="historial">${E.verHistorial ? "Ver solo pendientes" : "Ver historial"}</button>`) +
    (lista.length ? `<div class="sm-grid-negocios">${lista.map((s) => {
      const b = s.estado === "pendiente" ? `<span class="badge badge-yellow">Pendiente</span>` : s.estado === "aprobada" ? `<span class="badge badge-green">Aprobada</span>` : `<span class="badge badge-red">Rechazada</span>`;
      return `<div class="card"><div class="card-header"><div class="card-title">${esc(s.nombre)}</div>${b}</div><div class="card-body">
        <div class="crm-kv"><span>Deporte · Distrito</span><b>${esc(s.deporte)} · ${esc(s.distrito)}</b></div>
        <div class="crm-kv"><span>Dirección</span><b>${esc(s.direccion)}</b></div>
        <div class="crm-kv"><span>Teléfono</span><b>${esc(s.telefono)}</b></div>
        <div class="crm-kv"><span>Contacto</span><b>${esc(s.contacto)} · ${s.autoriza ? "autorizó publicar" : `<span style="color:var(--red)">no autorizó</span>`}</b></div>
        ${s.tipo ? `<div class="crm-kv"><span>Negocio</span><b>${esc(s.tipo)}${s.ruc ? " · RUC " + esc(s.ruc) : ""}</b></div>` : ""}
        ${s.correo ? `<div class="crm-kv"><span>Correo</span><b>${esc(s.correo)}</b></div>` : ""}
        <div class="crm-kv"><span>Recibida</span><b>${fechaCorta(s.creadoEn)}</b></div>
        ${s.estado === "pendiente" ? `<div class="sm-acciones">
          <button class="btn btn-green btn-sm" data-sm="aprobar-sol" data-id="${esc(s.id)}">Revisar y aprobar</button>
          <button class="btn btn-danger btn-sm" data-sm="rechazar-sol" data-id="${esc(s.id)}">Rechazar</button></div>` : ""}
      </div></div>`;
    }).join("")}</div>`
      : `<div class="card"><div class="empty-state"><h3>${E.verHistorial ? "Todavía no llegan solicitudes" : "No hay solicitudes pendientes"}</h3><p>Cuando una cancha use "Registrar mi cancha", aparecerá aquí.</p></div></div>`);
}

async function rechazarSolicitud(id) {
  const ok = await confirmar("¿Rechazar esta solicitud? No se publicará en la guía.", "Rechazar", true);
  if (!ok) return;
  try {
    const ahora = new Date().toISOString();
    await updateDoc(doc(db, "solicitudesCanchas", id), { estado: "rechazada", revisadoEn: ahora });
    const s = E.solicitudes.find((x) => x.id === id); if (s) s.estado = "rechazada";
    aviso("Solicitud rechazada.", "success");
    actualizarBadges();
    pintar("sm-solicitudes");
  } catch (e) { console.error(e); aviso("No se pudo actualizar.", "error"); }
}

// ═════════════════════════ USUARIOS ═════════════════════════
function vUsuarios() {
  const distritos = [...new Set(E.usuarios.map((u) => u.distrito).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  return cabecera("SportMatch · Usuarios", "Jugadores registrados. Por privacidad no se muestran DNI, teléfono, dirección ni correo.") + `
    <div class="filter-bar mb-4">
      <div class="search-wrap"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="search-input" id="smUBuscar" type="search" placeholder="Buscar por nombre"></div>
      <select id="smUDistrito" style="width:auto"><option value="">Todos los distritos</option>${distritos.map((d) => `<option>${esc(d)}</option>`).join("")}</select>
      <select id="smUEstado" style="width:auto"><option value="">Todos</option><option value="activos">Activos</option><option value="suspendidos">Suspendidos</option></select>
    </div>
    <div class="section-sub mb-4" id="smResumenUsuarios"></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Usuario</th><th>Distrito</th><th>Deportes</th><th>Registro</th><th>Partidos creados</th><th>Estado</th><th></th></tr></thead>
      <tbody id="smTablaUsuarios"></tbody></table></div></div>`;
}

function pintarTablaUsuarios() {
  const tb = $("smTablaUsuarios"); if (!tb) return;
  const t = norm($("smUBuscar")?.value.trim()), dis = $("smUDistrito")?.value, est = $("smUEstado")?.value;
  const creados = {}; E.partidos.forEach((p) => { if (p.creadorId) creados[p.creadorId] = (creados[p.creadorId] || 0) + 1; });
  const filas = E.usuarios.filter((u) => (!t || norm(u.nombre).includes(t)) && (!dis || u.distrito === dis) &&
    (!est || (est === "suspendidos" ? u.suspendido : !u.suspendido)))
    .sort((a, b) => String(b.creadoEn || "").localeCompare(String(a.creadoEn || "")));
  $("smResumenUsuarios").textContent = `${fmt(filas.length)} de ${fmt(E.usuarios.length)} usuarios`;
  tb.innerHTML = filas.length ? filas.map((u) => {
    const ini = esc(String(u.nombre || "?").trim().charAt(0).toUpperCase());
    const foto = u.foto && /^https:\/\//.test(u.foto) ? `<img class="sm-avatar" src="${esc(u.foto)}" alt="">` : `<span class="sm-avatar">${ini}</span>`;
    return `<tr>
      <td><div class="sm-con-avatar">${foto}<span class="td-name">${esc(u.nombre || "Sin nombre")}</span></div></td>
      <td>${esc(u.distrito || "—")}</td>
      <td>${esc((u.deportes || []).join(", ") || "—")}</td>
      <td class="td-mono">${fechaCorta(u.creadoEn)}</td>
      <td class="td-mono">${fmt(creados[u.id])}</td>
      <td>${u.suspendido ? `<span class="badge badge-red">Suspendido</span>` : `<span class="badge badge-green">Activo</span>`}</td>
      <td style="text-align:right">${u.suspendido
        ? `<button class="btn btn-ghost btn-sm" data-sm="suspender" data-id="${esc(u.id)}" data-valor="no">Reactivar</button>`
        : `<button class="btn btn-danger btn-sm" data-sm="suspender" data-id="${esc(u.id)}" data-valor="si">Suspender</button>`}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="7"><div class="sm-vacio">No hay usuarios con esos filtros.</div></td></tr>`;
}

async function suspenderUsuario(id, suspender) {
  const u = E.usuarios.find((x) => x.id === id);
  const ok = await confirmar(suspender
    ? `¿Suspender a <b>${esc(u?.nombre || "este usuario")}</b>? No podrá entrar a la app hasta que lo reactives.`
    : `¿Reactivar a <b>${esc(u?.nombre || "este usuario")}</b>?`, suspender ? "Suspender" : "Reactivar", suspender);
  if (!ok) return;
  try {
    await updateDoc(doc(db, "usuarios", id), { suspendido: suspender, suspendidoEn: suspender ? new Date().toISOString() : null });
    if (u) u.suspendido = suspender;
    aviso(suspender ? "Usuario suspendido." : "Usuario reactivado.", "success");
    pintarTablaUsuarios();
  } catch (e) { console.error(e); aviso("No se pudo actualizar el usuario.", "error"); }
}

// ── Modales propios (con el estilo del panel) ──────────────────────────
function modal(titulo, cuerpo, pie, ancho = 560) {
  let cont = $("sm-modal");
  if (!cont) { cont = document.createElement("div"); cont.id = "sm-modal"; cont.className = "modal-overlay"; document.body.appendChild(cont); }
  cont.innerHTML = `<div class="modal" style="width:${ancho}px"><div class="modal-header"><div class="modal-title">${titulo}</div><button class="modal-close" data-sm="cerrar-modal">✕</button></div>
    <div class="modal-body">${cuerpo}</div><div class="modal-footer">${pie}</div></div>`;
  cont.classList.add("open");
  cont.onclick = (e) => { if (e.target === cont) cerrarModal(); };
}
function cerrarModal() { const c = $("sm-modal"); if (c) { c.classList.remove("open"); c.innerHTML = ""; } }
function confirmar(texto, boton = "Aceptar", peligro = false) {
  return new Promise((resolver) => {
    modal("Confirmar", `<div style="line-height:1.7">${texto}</div>`,
      `<button class="btn btn-ghost" id="smNo">Cancelar</button><button class="btn ${peligro ? "btn-danger" : "btn-primary"}" id="smSi">${esc(boton)}</button>`, 440);
    const fin = (v) => { cerrarModal(); resolver(v); };
    $("smSi").addEventListener("click", () => fin(true));
    $("smNo").addEventListener("click", () => fin(false));
    $("sm-modal").onclick = (e) => { if (e.target.id === "sm-modal") fin(false); };
  });
}

// ── Eventos (delegados) ────────────────────────────────────────────────
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-sm]");
  if (!b || b.disabled) return;
  const a = b.dataset.sm, id = b.dataset.id;
  if (a === "cerrar-modal") return cerrarModal();
  if (a === "reintentar") { E.error = null; return abrir(E.vistaActual); }
  if (a === "recargar") { b.disabled = true; b.textContent = "Actualizando…"; await recargar(); return; }
  if (a === "ir") { e.preventDefault(); return irA(b.dataset.vista); }
  if (a === "tab-negocios") { E.tabNegocios = b.dataset.tab; return pintar("sm-negocios"); }
  if (a === "guardar-plan") return guardarPlan(id, b);
  if (a === "estado-negocio") return cambiarEstadoNegocio(id, b.dataset.estado);
  if (a === "marcar-cobro") return marcarCobro(id, b);
  if (a === "deshacer-cobro") return deshacerCobro(id);
  if (a === "csv-cobros") {
    const f = filasCobros(E.mesCobros);
    return descargarCSV(`sportmatch-cobros-${E.mesCobros}.csv`,
      ["Negocio", "Distrito", "RUC", "Monto inicial", "Membresía", "Ventas Market", "% comisión", "Comisión", "Total", "Estado"],
      f.map((x) => [x.n.nombre, x.n.distrito, x.n.ruc, x.setup, x.membresia, x.ventas, x.pct || 0, x.comision, x.total, x.registro ? "Cobrado" : "Pendiente"]));
  }
  if (a === "nueva-cancha") return abrirEditorCancha(null);
  if (a === "editar-cancha") return abrirEditorCancha(E.canchas.find((c) => c.id === id));
  if (a === "reporte-cancha") return abrirReporte(E.canchas.find((c) => c.id === id));
  if (a === "csv-canchas") {
    return descargarCSV(`sportmatch-canchas-${E.mesClics}.csv`,
      ["Deporte", "Nombre", "Distrito", "Dirección", "Teléfonos", "Visible", "Verificada", "Autorizó", "Destacada", `WhatsApp (${E.mesClics})`, "Llamar", "Cómo llegar", "Armar partido", "Total contactos", "Notas"],
      canchasFiltradas().map((c) => { const cl = E.clicsMes[c.id] || {}; return [c.s, c.n, c.d, c.a, (c.t || []).join(" / "), c.activa !== false ? "Sí" : "No", c.verificada ? "Sí" : "No", c.autorizo ? "Sí" : "No", c.destacada ? "Sí" : "No", cl.whatsapp || 0, cl.llamar || 0, cl.mapa || 0, cl.armar || 0, totalClics(cl), c.notas || ""]; }));
  }
  if (a === "historial") { E.verHistorial = !E.verHistorial; return pintar("sm-solicitudes"); }
  if (a === "aprobar-sol") return abrirEditorCancha(null, E.solicitudes.find((s) => s.id === id));
  if (a === "rechazar-sol") return rechazarSolicitud(id);
  if (a === "suspender") return suspenderUsuario(id, b.dataset.valor === "si");
});

document.addEventListener("input", (e) => {
  if (["smFBuscar", "smFDeporte", "smFDistrito", "smFEstado"].includes(e.target.id)) pintarTablaCanchas();
  if (["smUBuscar", "smUDistrito", "smUEstado"].includes(e.target.id)) pintarTablaUsuarios();
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "smFMes") {
    E.mesClics = e.target.value;
    $("smResumenCanchas").textContent = "Cargando contactos…";
    E.clicsMes = await leerClicsMes(E.mesClics);
    pintarTablaCanchas();
  }
  if (e.target.dataset?.sm === "mes-cobros") { E.mesCobros = e.target.value; pintar("sm-cobros"); }
});

function irA(vista) {
  const el = document.querySelector(`.nav-item[data-view="${vista}"]`);
  if (typeof window.navigate === "function") window.navigate(vista, el);
}

// ── Arranque: al iniciar sesión en Etrazia, conecta en segundo plano
//    para mostrar los pendientes en el menú; al salir, cierra SportMatch.
let arrancado = false;
function arrancar() {
  const etAuth = etraziaAuth();
  if (!etAuth) return setTimeout(arrancar, 300);
  onAuthStateChanged(etAuth, async (u) => {
    if (!u) {
      E.conectado = false; E.cargado = false; arrancado = false;
      if (smAuth.currentUser) signOut(smAuth).catch(() => {});
      return;
    }
    if (arrancado) return;
    arrancado = true;
    const destino = (location.hash || "").slice(1);
    if (VISTAS.includes(destino)) setTimeout(() => irA(destino), 400);
    if (await conectar()) { try { await cargar(); } catch (e) {} }
  });
}
arrancar();

window.smAdmin = { abrir };
