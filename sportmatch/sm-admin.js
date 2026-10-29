// ═══════════════════════════════════════════════════════════════════════
// MÓDULO SPORTMATCH — Etraziapp Admin
// Administra Sports Match (proyecto Firebase "sportmatch-mvp") desde este
// panel. Los datos NO se copian: se leen y se cambian directo en Sports
// Match, así que todo se refleja al instante en la app de Personas y
// Negocios. Los cobros confirmados pasan a Facturación de este panel.
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
  getFirestore, collection, getDocs, getDoc, doc, setDoc, addDoc, updateDoc, deleteDoc, query, where, writeBatch, serverTimestamp
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
const URL_APP = "https://sportsmatch.etraziapp.com";

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
const VISTAS = ["sm-resumen", "sm-negocios", "sm-personas", "sm-torneos", "sm-cobros", "sm-canchas"];

// ── Tarifas: cada parámetro es { tipo: "%" | "S/", valor } · en 0 o vacío no se cobra ──
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const param = (p) => (p && Number(p.valor) > 0 ? { tipo: p.tipo === "S/" ? "S/" : "%", valor: Number(p.valor) } : null);
const textoParam = (p, porUnidad) => { const q = param(p); return q ? (q.tipo === "%" ? `${q.valor}%` : `${soles(q.valor)} ${porUnidad}`) : "—"; };
// Monto a cobrar: si es %, sobre la base; si es S/, por cada unidad
const cargo = (p, base, unidades) => { const q = param(p); return !q ? 0 : r2(q.tipo === "%" ? base * q.valor / 100 : q.valor * unidades); };
function planDe(n) {
  const p = n.plan || {};
  return {
    setup: Number(p.setup) || 0, membresia: Number(p.membresia) || 0,
    marketplace: p.marketplace !== undefined ? p.marketplace : (p.comision != null ? { tipo: "%", valor: Number(p.comision) } : null),
    reservas: p.reservas || null, torneoInicial: p.torneoInicial || null, torneoInscripcion: p.torneoInscripcion || null
  };
}
function funcionesDe(n) {
  if (n && n.funciones) return { canchas: !!n.funciones.canchas, marketplace: !!n.funciones.marketplace };
  return { canchas: !n || n.tipo !== "Tienda", marketplace: !n || n.tipo !== "Canchas" };
}
const textoFunciones = (n) => { const f = funcionesDe(n); return [f.canchas ? "Canchas" : "", f.marketplace ? "Marketplace" : ""].filter(Boolean).join(" + ") || "—"; };
// Lo que le toca a Sports Match por un torneo, según la tarifa guardada al crearlo
function cargoTorneo(t) {
  const n = (t.inscritos || []).length;
  const recaudado = r2((Number(t.precio) || 0) * n);
  const tf = t.tarifa || {};
  const inicial = param(tf.inicial) ? (param(tf.inicial).tipo === "%" ? r2(recaudado * param(tf.inicial).valor / 100) : param(tf.inicial).valor) : 0;
  const inscripcion = cargo(tf.inscripcion, recaudado, n);
  return { inscritos: n, recaudado, inicial, inscripcion, total: r2(inicial + inscripcion) };
}
const textoTarifaTorneo = (tf) => {
  const a = param(tf?.inicial), b = param(tf?.inscripcion);
  const p = [];
  if (a) p.push(a.tipo === "%" ? `${a.valor}% de lo recaudado` : `${soles(a.valor)} por torneo`);
  if (b) p.push(b.tipo === "%" ? `${b.valor}% por inscripción` : `${soles(b.valor)} por inscrito`);
  return p.join(" + ") || "Sin tarifa";
};

// ── Estado ─────────────────────────────────────────────────────────────
const E = {
  conectado: false, conectando: null, error: null, cargado: false, cargando: null,
  usuarios: [], partidos: [], grupos: [], torneos: [], canchas: [], negocios: [],
  sedes: [], productos: [], pedidos: [], reservas: [], cobros: [], clicsDiarios: [], clicsMes: {},
  tarifas: {}, privados: {}, seguimiento: {}, mensajes: {},
  mesClics: mesActual(), mesCobros: mesActual(), tabNegocios: "pendiente", tabTorneos: "vigentes",
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
      leer("negocios", collection(db, "negocios"), fallos),
      leer("sedes", collection(db, "sedes"), fallos),
      leer("pedidos", collection(db, "pedidos"), fallos),
      leer("reservas", collection(db, "reservas"), fallos),
      leer("cobros", collection(db, "cobros"), fallos),
      leer("contactos diarios", query(collection(db, "clicsDiarios"), where("dia", ">=", desde)), fallos),
      leerClicsMes(E.mesClics),
      getDoc(doc(db, "config", "tarifas")).then((d) => (d.exists() ? d.data() : {})).catch(() => { fallos.push("tarifas"); return {}; })
    ]);
    [E.usuarios, E.partidos, E.grupos, E.torneos, E.canchas, E.negocios,
      E.sedes, E.pedidos, E.reservas, E.cobros, E.clicsDiarios, E.clicsMes, E.tarifas] = r;
    // Datos de contacto (privados) de cada Persona: celular, correo y si acepta novedades.
    // Solo los ve el superadmin; las demás Personas de la app nunca los ven.
    const ids = [...new Set(E.usuarios.map((u) => u.id).concat(E.torneos.filter((t) => !t.negocioId).map((t) => t.creadorId)).filter(Boolean))];
    E.privados = {};
    await Promise.all(ids.map(async (u) => {
      try { const d = await getDoc(doc(db, "usuarios", u, "privado", "datos")); E.privados[u] = d.exists() ? d.data() : {}; }
      catch (e) { E.privados[u] = {}; }
    }));
    // A quién ya se le dio la bienvenida, y el mensaje de bienvenida guardado
    const seg = await leer("seguimiento", collection(db, "seguimientoPersonas"), []);
    E.seguimiento = {}; seg.forEach((x) => { E.seguimiento[x.id] = x; });
    E.mensajes = await getDoc(doc(db, "config", "mensajes")).then((d) => (d.exists() ? d.data() : {})).catch(() => ({}));
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
  const poner = (id, n) => { const b = $(id); if (!b) return; b.textContent = n; b.style.display = n ? "" : "none"; };
  poner("badge-sportmatch", negPend);
  poner("badge-sm-negocios", negPend);
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
  const f = { "sm-resumen": vResumen, "sm-negocios": vNegocios, "sm-personas": vPersonas, "sm-torneos": vTorneos, "sm-cobros": vCobros, "sm-canchas": vCanchas }[vista];
  cont.innerHTML = f();
  if (vista === "sm-canchas") pintarTablaCanchas();
  if (vista === "sm-personas") pintarTablaPersonas();
  if (vista === "sm-torneos") pintarTablaTorneos();
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
  const porCobrar = filasCobros(mes).filter((f) => !f.registro).reduce((a, f) => a + f.total, 0);

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
      ${kpi("accent", "Personas", fmt(E.usuarios.length), `+${fmt(nuevos7)} en 7 días`)}
      ${kpi("green", "Negocios verificados", fmt(negVer), negPend ? `${negPend} por verificar` : "todo al día")}
      ${kpi("blue", "Reservas del mes", fmt(resMes.length), `${fmt(resConf.length)} con pago confirmado`)}
      ${kpi("accent", "Ventas Marketplace del mes", soles(totalVentas), `${fmt(ventasMes.length)} pedidos confirmados`)}
    </div>
    <div class="grid-4 mb-6">
      ${kpi("blue", "Partidos activos", fmt(activos.length), `${fmt(E.partidos.filter((p) => String(p.creadoEn || "").startsWith(mes)).length)} creados este mes`)}
      ${kpi("green", "Torneos abiertos", fmt(torneosAb), `${fmt(E.torneos.length)} en total`)}
      ${kpi("accent", "Contactos a canchas", fmt(contactosMes), "desde la guía, este mes")}
      ${kpi("green", "Por cobrar este mes", soles(porCobrar), "a Negocios y Personas")}
    </div>
    <div class="card mb-4"><div class="card-header"><div class="card-title">Contactos a canchas · últimos 30 días</div><span class="td-mono">Total ${fmt(total30)}</span></div>
      <div class="card-body">${total30 === 0 ? `<div class="sm-vacio">Todavía no hay contactos. Aparecerán cuando la gente use los botones de la guía de canchas.</div>` : `
        <div class="sm-columnas">${dias.map((d, i) => `<div class="sm-col" title="${etiquetaDia(d)}: ${fmt(vals[i])} contactos"><span style="height:${(vals[i] / max) * 100}%"></span></div>`).join("")}</div>
        <div class="sm-eje"><span>${etiquetaDia(dias[0])}</span><span>${etiquetaDia(dias[15])}</span><span>Hoy</span></div>`}
      </div></div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><div class="card-title">Canchas más contactadas · ${esc(nombreMes(E.mesClics))}</div></div><div class="card-body">${barrasH(top, "Aún no hay contactos en este mes.")}</div></div>
      <div class="card"><div class="card-header"><div class="card-title">Personas por distrito</div></div><div class="card-body">${barrasH(Object.entries(cuentaDist).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d, n]) => ({ etiqueta: d, valor: n })), "Todavía no hay personas registradas.")}</div></div>
      <div class="card"><div class="card-header"><div class="card-title">Partidos activos por deporte</div></div><div class="card-body">${barrasH(["Tenis", "Pádel", "Fútbol", "Básket"].map((d) => ({ etiqueta: d, valor: activos.filter((p) => p.deporte === d).length })), "No hay partidos activos ahora.")}</div></div>
      <div class="card"><div class="card-header"><div class="card-title">Contactos por tipo · ${esc(nombreMes(mes))}</div></div><div class="card-body">${barrasH(TIPOS_CLIC.map((t) => ({ etiqueta: t.texto, valor: E.clicsDiarios.filter((d) => String(d.dia).startsWith(mes)).reduce((s, d) => s + Number(d[t.clave] || 0), 0) })))}</div></div>
    </div>`;
}

// ═════════════════════════ NEGOCIOS ═════════════════════════
const PARAMS_NEGOCIO = [
  { clave: "marketplace", titulo: "Marketplace", pct: "% de las ventas confirmadas del mes", monto: "S/ por cada pedido confirmado", unidad: "por pedido" },
  { clave: "reservas", titulo: "Reservas de cancha", pct: "% del valor de las reservas pagadas", monto: "S/ por cada reserva pagada", unidad: "por reserva" },
  { clave: "torneoInicial", titulo: "Torneo · por publicarlo", pct: "% de lo recaudado en inscripciones", monto: "S/ fijo por cada torneo", unidad: "por torneo" },
  { clave: "torneoInscripcion", titulo: "Torneo · por inscripción", pct: "% de cada inscripción", monto: "S/ por cada inscrito aceptado", unidad: "por inscrito" }
];

function campoParam(p, valor) {
  const q = valor || {};
  const tipo = q.tipo === "S/" ? "S/" : "%";
  return `<div class="sm-param" data-param="${p.clave}">
    <div class="sm-param-titulo"><b>${p.titulo}</b><small data-ayuda>${tipo === "%" ? p.pct : p.monto}</small></div>
    <div class="sm-param-campos">
      <select data-tipo data-pct="${esc(p.pct)}" data-monto="${esc(p.monto)}"><option value="%" ${tipo === "%" ? "selected" : ""}>%</option><option value="S/" ${tipo === "S/" ? "selected" : ""}>S/</option></select>
      <input type="number" min="0" step="0.5" data-valor value="${q.valor > 0 ? esc(q.valor) : ""}" placeholder="0">
    </div></div>`;
}
function leerParam(cont, clave) {
  const caja = cont.querySelector(`[data-param="${clave}"]`);
  const valor = Number(caja.querySelector("[data-valor]").value);
  const tipo = caja.querySelector("[data-tipo]").value;
  if (!(valor > 0)) return null;
  if (tipo === "%" && valor > 100) throw new Error("El porcentaje debe estar entre 0 y 100.");
  return { tipo, valor };
}

function datosMesNegocio(n, mes) {
  const plan = planDe(n);
  const ventas = E.pedidos.filter((p) => p.negocioId === n.id && ["confirmado", "entregado"].includes(p.estado) && p.mes === mes);
  const totalVentas = r2(ventas.reduce((a, p) => a + (Number(p.total) || 0), 0));
  const delMes = E.reservas.filter((r) => r.negocioId === n.id && String(r.fecha).startsWith(mes) && r.origen === "app");
  const pagadas = delMes.filter((r) => r.estado === "confirmado");
  const montoReservas = r2(pagadas.reduce((a, r) => a + (Number(r.precio) || 0), 0));
  const torneos = E.torneos.filter((t) => t.negocioId === n.id && t.estado !== "cancelado" && String(t.fechaInicio).startsWith(mes))
    .map((t) => ({ t, ...cargoTorneo(t) }));
  return {
    plan, pedidos: ventas.length, totalVentas, marketplace: cargo(plan.marketplace, totalVentas, ventas.length),
    reservasMes: delMes.filter((r) => ["reservado", "confirmado"].includes(r.estado)).length,
    reservasPagadas: pagadas.length, montoReservas, reservas: cargo(plan.reservas, montoReservas, pagadas.length),
    torneos, cargoTorneos: r2(torneos.reduce((a, x) => a + x.total, 0))
  };
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

  return cabecera("SportMatch · Negocios", "Los Negocios se registran desde la app. Llámalos para verificar sus datos antes de activarlos: solo los verificados aparecen para las Personas. Aquí también defines lo que le cobras a cada uno.") + `
    <div class="crm-tabs">${tabs.map(([k, l]) => `<button class="crm-tab ${E.tabNegocios === k ? "active" : ""}" data-sm="tab-negocios" data-tab="${k}">${l} <span class="crm-count">${cuenta(k)}</span></button>`).join("")}</div>
    ${lista.length ? `<div class="sm-grid-negocios">${lista.map((n) => {
      const d = datosMesNegocio(n, mes);
      const sedes = E.sedes.filter((s) => s.negocioId === n.id).length;
      return `<div class="card sm-negocio" data-negocio="${esc(n.id)}">
        <div class="card-header"><div class="card-title">${esc(n.nombre || "Sin nombre")}</div>${badge(n)}</div>
        <div class="card-body">
          <div class="crm-kv"><span>Usa</span><b>${esc(textoFunciones(n))}${(n.deportes || []).length ? " · " + esc(n.deportes.join(", ")) : ""}</b></div>
          <div class="crm-kv"><span>Ubicación</span><b>${esc(n.distrito || "—")} · ${esc(n.direccion || "")}</b></div>
          <div class="crm-kv"><span>Responsable</span><b>${esc(n.responsable || "—")}</b></div>
          <div class="crm-kv"><span>WhatsApp</span><b>${n.telefono ? `<a href="https://wa.me/51${esc(String(n.telefono).replace(/\D/g, "").slice(-9))}" target="_blank" rel="noopener">${esc(n.telefono)}</a>` : "—"}</b></div>
          <div class="crm-kv"><span>Correo · RUC</span><b>${esc(n.correo || "—")} · ${esc(n.ruc || "—")}</b></div>
          <div class="crm-kv"><span>Registrado</span><b>${fechaCorta(n.creadoEn)}${n.verificadoEn ? ` · verificado ${fechaCorta(n.verificadoEn)}` : ""}</b></div>
          <div class="crm-kv"><span>Este mes</span><b>${fmt(sedes)} sedes · ${fmt(d.reservasMes)} reservas · ${soles(d.totalVentas)} en Marketplace · ${fmt(d.torneos.length)} torneos</b></div>
          <div class="sm-plan">
            <div class="form-label" style="margin:16px 0 4px">Lo que le cobras</div>
            <div class="section-sub" style="margin-bottom:10px">Elige % o S/ en cada comisión. Lo que quede en 0 o vacío no se cobra.</div>
            <div class="sm-plan-campos">
              <label><span>Monto inicial (S/, una sola vez)</span><input type="number" min="0" step="1" data-fijo="setup" value="${d.plan.setup > 0 ? esc(d.plan.setup) : ""}" placeholder="0"></label>
              <label><span>Membresía mensual (S/)</span><input type="number" min="0" step="1" data-fijo="membresia" value="${d.plan.membresia > 0 ? esc(d.plan.membresia) : ""}" placeholder="0"></label>
            </div>
            <div class="sm-params">${PARAMS_NEGOCIO.map((p) => campoParam(p, d.plan[p.clave])).join("")}</div>
            <div class="section-sub" style="margin-top:8px">Las tarifas de torneo se aplican a los torneos que el negocio publique desde que las guardes.</div>
          </div>
          <div class="sm-acciones">
            <button class="btn btn-ghost btn-sm" data-sm="guardar-plan" data-id="${esc(n.id)}">Guardar</button>
            ${est(n) !== "verificado" ? `<button class="btn btn-green btn-sm" data-sm="estado-negocio" data-estado="verificado" data-id="${esc(n.id)}">✓ Verificar</button>` : ""}
            ${est(n) !== "rechazado" ? `<button class="btn btn-danger btn-sm" data-sm="estado-negocio" data-estado="rechazado" data-id="${esc(n.id)}">${est(n) === "verificado" ? "Desactivar" : "Rechazar"}</button>` : ""}
          </div>
        </div></div>`;
    }).join("")}</div>` : `<div class="card"><div class="empty-state"><h3>Nada por aquí</h3><p>${E.tabNegocios === "pendiente" ? "No hay negocios esperando verificación." : "Todavía no hay negocios en este grupo."}</p></div></div>`}`;
}

async function guardarPlan(id, boton) {
  const tarjeta = boton.closest("[data-negocio]");
  const fijo = (k) => { const v = Number(tarjeta.querySelector(`[data-fijo="${k}"]`).value); return v > 0 ? v : 0; };
  let plan;
  try {
    plan = { setup: fijo("setup"), membresia: fijo("membresia") };
    PARAMS_NEGOCIO.forEach((p) => { plan[p.clave] = leerParam(tarjeta, p.clave); });
  } catch (e) { aviso(e.message, "error"); return; }
  boton.disabled = true;
  try {
    await updateDoc(doc(db, "negocios", id), { plan, revisadoEn: new Date().toISOString() });
    const n = E.negocios.find((x) => x.id === id); if (n) n.plan = plan;
    aviso("Guardado.", "success");
  } catch (e) { console.error(e); aviso("No se pudo guardar.", "error"); }
  boton.disabled = false;
}

async function cambiarEstadoNegocio(id, nuevo) {
  const n = E.negocios.find((x) => x.id === id);
  const ok = await confirmar(nuevo === "verificado"
    ? `¿Verificar a <b>${esc(n?.nombre)}</b>?<br><span class="td-mono">Sus sedes, productos y torneos aparecerán para las Personas.</span>`
    : `¿Desactivar a <b>${esc(n?.nombre)}</b>?<br><span class="td-mono">Sus sedes y productos dejarán de verse en la app.</span>`,
    nuevo === "verificado" ? "Verificar" : "Desactivar", nuevo !== "verificado");
  if (!ok) return;
  try {
    const ahora = new Date().toISOString();
    const cambios = { estado: nuevo, revisadoEn: ahora };
    if (nuevo === "verificado" && !n?.verificadoEn) cambios.verificadoEn = ahora;
    await updateDoc(doc(db, "negocios", id), cambios);
    // Se muestra solo lo que el negocio tiene activo (Canchas y/o Marketplace)
    const f = funcionesDe(n);
    const verificado = nuevo === "verificado";
    const [sedes, productos] = await Promise.all([
      getDocs(query(collection(db, "sedes"), where("negocioId", "==", id))),
      getDocs(query(collection(db, "productos"), where("negocioId", "==", id)))
    ]);
    if (!sedes.empty || !productos.empty) {
      const lote = writeBatch(db);
      sedes.forEach((d) => lote.update(d.ref, { visible: verificado && f.canchas }));
      productos.forEach((d) => lote.update(d.ref, { visible: verificado && f.marketplace }));
      await lote.commit();
    }
    if (n) Object.assign(n, cambios);
    E.sedes.forEach((s) => { if (s.negocioId === id) s.visible = verificado && f.canchas; });
    aviso(verificado ? "Negocio verificado: ya aparece para las Personas." : "Negocio desactivado.", "success");
    actualizarBadges();
    pintar("sm-negocios");
  } catch (e) { console.error(e); aviso("No se pudo actualizar el negocio.", "error"); }
}

// ═════════════════════════ COBROS ═════════════════════════
// Una fila por Negocio verificado y por cada Persona que organizó torneos en el mes.
function filasCobros(mes) {
  const finMes = mes + "-31";
  const filas = [];
  const total = (x) => r2(x.setup + x.membresia + x.marketplace + x.reservas + x.torneos);
  const desdeRegistro = (c) => ({ setup: Number(c.setup) || 0, membresia: Number(c.membresia) || 0, marketplace: Number(c.marketplace) || 0, reservas: Number(c.reservas) || 0, torneos: Number(c.torneos) || 0 });

  E.negocios.filter((n) => n.estado === "verificado" && String(n.verificadoEn || n.creadoEn || "").slice(0, 10) <= finMes).forEach((n) => {
    const d = datosMesNegocio(n, mes);
    const clave = `negocio_${n.id}_${mes}`;
    const registro = E.cobros.find((c) => c.id === clave);
    const setupCobrado = E.cobros.some((c) => c.tipo === "negocio" && c.quienId === n.id && c.mes !== mes && Number(c.setup) > 0);
    const v = registro ? desdeRegistro(registro)
      : { setup: setupCobrado ? 0 : d.plan.setup, membresia: d.plan.membresia, marketplace: d.marketplace, reservas: d.reservas, torneos: d.cargoTorneos };
    filas.push({ clave, tipo: "negocio", id: n.id, nombre: n.nombre || "Negocio", distrito: n.distrito || "", documento: n.ruc ? "RUC " + n.ruc : "",
      correo: n.correo || "", telefono: n.telefono || "", ...v, total: registro ? Number(registro.total) || 0 : total(v), registro, d, n });
  });

  const porPersona = {};
  E.torneos.filter((t) => !t.negocioId && t.estado !== "cancelado" && String(t.fechaInicio).startsWith(mes))
    .forEach((t) => { (porPersona[t.creadorId] = porPersona[t.creadorId] || []).push(t); });
  Object.entries(porPersona).forEach(([uid, lista]) => {
    const clave = `persona_${uid}_${mes}`;
    const registro = E.cobros.find((c) => c.id === clave);
    const cargos = lista.map((t) => ({ t, ...cargoTorneo(t) }));
    const torneos = r2(cargos.reduce((a, x) => a + x.total, 0));
    if (!registro && torneos <= 0) return;
    const u = E.usuarios.find((x) => x.id === uid) || {};
    const pr = E.privados[uid] || {};
    const v = registro ? desdeRegistro(registro) : { setup: 0, membresia: 0, marketplace: 0, reservas: 0, torneos };
    filas.push({ clave, tipo: "persona", id: uid, nombre: u.nombre || lista[0].creadorNombre || "Persona", distrito: u.distrito || "",
      documento: pr.numeroDocumento ? `${pr.tipoDocumento || "DNI"} ${pr.numeroDocumento}` : "", correo: pr.correo || "", telefono: pr.telefono || "",
      ...v, total: registro ? Number(registro.total) || 0 : total(v), registro, cargos });
  });

  // Cobros ya registrados que ya no calzan con los datos de hoy (ej. un torneo que luego se canceló)
  E.cobros.filter((c) => c.mes === mes && !filas.some((f) => f.clave === c.id)).forEach((c) => {
    filas.push({ clave: c.id, tipo: c.tipo, id: c.quienId, nombre: c.nombre, distrito: c.distrito || "", documento: c.documento || "",
      correo: c.correo || "", telefono: c.telefono || "", ...desdeRegistro(c), total: Number(c.total) || 0, registro: c });
  });

  return filas.sort((a, b) => (a.registro ? 1 : 0) - (b.registro ? 1 : 0) || b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
}

function vCobros() {
  const mes = E.mesCobros;
  const filas = filasCobros(mes);
  const pend = filas.filter((f) => !f.registro), hechos = filas.filter((f) => f.registro);
  const porCobrar = r2(pend.reduce((a, f) => a + f.total, 0));
  const cobrado = r2(hechos.reduce((a, f) => a + f.total, 0));
  const sinPlan = filas.filter((f) => f.tipo === "negocio" && !f.registro && f.total === 0).length;
  const tp = E.tarifas || {};
  const sel = `<select data-sm="mes-cobros" style="width:auto">${ultimosMeses(12).map((m) => `<option value="${m}" ${m === mes ? "selected" : ""}>${esc(nombreMes(m))}</option>`).join("")}</select>`;
  const celda = (v) => v ? soles(v) : `<span style="color:var(--text2)">—</span>`;

  return cabecera("SportMatch · Cobros", "Lo que te debe cada Negocio y cada Persona en el mes, según sus tarifas. Al marcar \"Cobrado\", el cobro pasa a Facturación como cobrado (sin SUNAT).", sel +
      `<button class="btn btn-ghost btn-sm" data-sm="csv-cobros">⬇ Descargar Excel</button>`) + `
    <div class="grid-3 mb-4">
      <div class="stat-card accent"><div class="stat-label">Por cobrar</div><div class="stat-value">${soles(porCobrar)}</div><div class="stat-sub">${fmt(pend.length)} pendientes</div></div>
      <div class="stat-card green"><div class="stat-label">Cobrado</div><div class="stat-value">${soles(cobrado)}</div><div class="stat-sub">${fmt(hechos.length)} cobros</div></div>
      <div class="stat-card blue"><div class="stat-label">Total del mes</div><div class="stat-value">${soles(r2(porCobrar + cobrado))}</div><div class="stat-sub">${esc(nombreMes(mes))}</div></div>
    </div>
    ${sinPlan ? `<div class="sm-banner mb-4">${fmt(sinPlan)} negocio(s) verificado(s) no tienen nada por cobrar este mes. Revisa sus tarifas en <a href="#" data-sm="ir" data-vista="sm-negocios">Negocios</a>.</div>` : ""}
    <div class="card mb-4"><div class="table-wrap">
      ${filas.length ? `<table><thead><tr><th>Quién</th><th>Monto inicial</th><th>Membresía</th><th>Marketplace</th><th>Reservas</th><th>Torneos</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>
      ${filas.map((f) => `<tr>
        <td class="td-name">${esc(f.nombre)}<div class="td-mono">${f.tipo === "negocio" ? "Negocio" : "Persona"}${f.distrito ? " · " + esc(f.distrito) : ""}</div></td>
        <td class="td-mono">${celda(f.setup)}</td>
        <td class="td-mono">${celda(f.membresia)}</td>
        <td class="td-mono">${celda(f.marketplace)}</td>
        <td class="td-mono">${celda(f.reservas)}</td>
        <td class="td-mono">${celda(f.torneos)}</td>
        <td class="td-name">${soles(f.total)}</td>
        <td>${f.registro ? `<span class="badge badge-green">Cobrado</span><div class="td-mono">${fechaCorta(f.registro.cobradoEn)}</div>` : `<span class="badge badge-yellow">Pendiente</span>`}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn-ghost btn-sm" data-sm="ver-cobro" data-clave="${esc(f.clave)}">Detalle</button>
          ${f.registro
            ? `<button class="btn btn-ghost btn-sm" data-sm="deshacer-cobro" data-id="${esc(f.clave)}">Deshacer</button>`
            : `<button class="btn btn-green btn-sm" data-sm="marcar-cobro" data-clave="${esc(f.clave)}" ${f.total > 0 ? "" : "disabled title='No hay monto por cobrar'"}>Marcar cobrado</button>`}</td>
      </tr>`).join("")}</tbody></table>` : `<div class="empty-state"><h3>Sin cobros este mes</h3><p>Aquí aparecerán los Negocios verificados y las Personas que organicen torneos con tarifa.</p></div>`}
    </div></div>

    <div class="card">
      <div class="card-header"><div class="card-title">Tarifa general para Personas que organizan torneos</div></div>
      <div class="card-body" id="smTarifasPersonas">
        <div class="section-sub" style="margin-bottom:12px">Se aplica a todas las Personas. Lo que quede en 0 o vacío no se cobra. Cada torneo guarda la tarifa vigente cuando se publica; si la cambias, aplica a los torneos nuevos.</div>
        <div class="sm-params">${PARAMS_NEGOCIO.filter((p) => p.clave.startsWith("torneo")).map((p) => campoParam(p, tp[p.clave])).join("")}</div>
        <div class="sm-acciones"><button class="btn btn-primary btn-sm" data-sm="guardar-tarifas">Guardar tarifa</button>
          ${tp.actualizadoEn ? `<span class="td-mono" style="align-self:center">Actualizada ${fechaCorta(tp.actualizadoEn)}</span>` : ""}</div>
      </div>
    </div>`;
}

function verDetalleCobro(clave) {
  const f = filasCobros(E.mesCobros).find((x) => x.clave === clave);
  if (!f) return;
  const fila = (k, v) => `<div class="crm-kv"><span>${k}</span><b>${v}</b></div>`;
  const listaTorneos = (cargos) => cargos && cargos.length ? `<div class="form-label" style="margin:16px 0 6px">Torneos del mes</div>
    <div class="table-wrap"><table><thead><tr><th>Torneo</th><th>Inscritos</th><th>Recaudado</th><th>Tarifa</th><th>Cargo</th></tr></thead><tbody>
    ${cargos.map((c) => `<tr><td class="td-name">${esc(c.t.nombre)}<div class="td-mono">${esc(c.t.fechaInicio)}</div></td><td class="td-mono">${fmt(c.inscritos)}</td><td class="td-mono">${soles(c.recaudado)}</td><td class="td-mono">${esc(textoTarifaTorneo(c.t.tarifa))}</td><td class="td-name">${soles(c.total)}</td></tr>`).join("")}
    </tbody></table></div>` : "";
  let cuerpo = "";
  if (f.registro) cuerpo += `<div class="sm-banner mb-4">Cobrado el ${fechaCorta(f.registro.cobradoEn)}. Estos montos quedaron guardados al momento de cobrar${f.registro.facturacion ? " y están en Facturación" : ""}.</div>`;
  cuerpo += fila("Tipo", f.tipo === "negocio" ? "Negocio" : "Persona") + (f.documento ? fila("Documento", esc(f.documento)) : "") +
    (f.telefono ? fila("Teléfono", `<a href="https://wa.me/51${esc(String(f.telefono).replace(/\D/g, "").slice(-9))}" target="_blank" rel="noopener">${esc(f.telefono)}</a>`) : "") +
    (f.correo ? fila("Correo", esc(f.correo)) : "");
  if (f.tipo === "negocio" && f.d) {
    const p = f.d.plan;
    cuerpo += `<div class="form-label" style="margin:16px 0 6px">Cálculo de ${esc(nombreMes(E.mesCobros))}</div>` +
      fila("Monto inicial", f.setup ? soles(f.setup) : (p.setup ? "Ya cobrado antes" : "—")) +
      fila("Membresía", soles(f.membresia)) +
      fila(`Marketplace (${textoParam(p.marketplace, "por pedido")})`, `${soles(f.d.totalVentas)} vendidos en ${fmt(f.d.pedidos)} pedidos → <b>${soles(f.marketplace)}</b>`) +
      fila(`Reservas (${textoParam(p.reservas, "por reserva")})`, `${fmt(f.d.reservasPagadas)} reservas pagadas por ${soles(f.d.montoReservas)} → <b>${soles(f.reservas)}</b>`) +
      fila("Torneos", soles(f.torneos)) + listaTorneos(f.d.torneos);
  } else if (f.cargos) cuerpo += listaTorneos(f.cargos);
  cuerpo += `<div class="crm-kv" style="font-size:15px"><span>Total</span><b>${soles(f.total)}</b></div>`;
  modal(esc(f.nombre), cuerpo, `<button class="btn btn-ghost" data-sm="cerrar-modal">Cerrar</button>`, 680);
}

// Pasa el cobro a Facturación (CRM de Etrazia): crea el cliente la primera vez
const edb = () => getFirestore(getApp());
const hoyLocal = () => hoyISO();
async function registrarEnFacturacion(f, mes, clave) {
  const smId = `${f.tipo}:${f.id}`;
  const snap = await getDocs(query(collection(edb(), "clientes"), where("smId", "==", smId)));
  let clienteId, facturas;
  if (snap.empty) {
    const ref = await addDoc(collection(edb(), "clientes"), {
      nombre: f.nombre, ruc: f.tipo === "negocio" ? String(f.documento || "").replace(/^RUC\s*/, "") : "", estado: "cliente",
      email: f.correo || "", telefono: f.telefono || "", web: "",
      notas: `Cliente de SportMatch (${f.tipo === "negocio" ? "Negocio" : "Persona"}${f.documento && f.tipo === "persona" ? " · " + f.documento : ""}). Creado automáticamente al registrar su primer cobro.`,
      contactos: [], interacciones: [], documentos: [], activos: [], facturas: [], cotizacionesVinculadas: [],
      origen: "SportMatch", smId, createdAt: serverTimestamp()
    });
    clienteId = ref.id; facturas = [];
  } else { clienteId = snap.docs[0].id; facturas = snap.docs[0].data().facturas || []; }
  const partes = [["Monto inicial", f.setup], ["Membresía", f.membresia], ["Marketplace", f.marketplace], ["Reservas", f.reservas], ["Torneos", f.torneos]]
    .filter(([, v]) => v > 0).map(([k]) => k);
  const item = {
    id: "sm-" + clave, numero: "", concepto: `SportMatch · ${partes.join(" + ")} · ${nombreMes(mes)}`, monto: f.total, moneda: "PEN",
    fechaEmision: hoyLocal(), estado: "pagada", fechaPago: hoyLocal(), detraccion: 0, detraccionPct: 0, origen: "SportMatch", cobroId: clave
  };
  await updateDoc(doc(edb(), "clientes", clienteId), { facturas: [...facturas.filter((x) => x.id !== item.id), item] });
  return { clienteId, facturaId: item.id };
}
async function quitarDeFacturacion(fac) {
  if (!fac?.clienteId) return;
  const ref = doc(edb(), "clientes", fac.clienteId);
  const c = await getDoc(ref);
  if (!c.exists()) return;
  await updateDoc(ref, { facturas: (c.data().facturas || []).filter((x) => x.id !== fac.facturaId) });
}

async function marcarCobro(clave, boton) {
  const mes = E.mesCobros;
  const f = filasCobros(mes).find((x) => x.clave === clave);
  if (!f || f.registro) return;
  const ok = await confirmar(`¿Marcar como cobrado <b>${soles(f.total)}</b> a <b>${esc(f.nombre)}</b> por ${esc(nombreMes(mes))}?<br>
    <span class="td-mono">Se registra en Facturación como cobrado${f.tipo === "persona" ? "" : ""}. Si es su primer cobro, se crea como cliente en tu CRM.</span>`, "Marcar cobrado");
  if (!ok) return;
  boton.disabled = true;
  let fac = null;
  try { fac = await registrarEnFacturacion(f, mes, clave); }
  catch (e) { console.error(e); aviso("No se pudo registrar en Facturación. No se marcó el cobro.", "error"); boton.disabled = false; return; }
  const datos = {
    tipo: f.tipo, quienId: f.id, nombre: f.nombre, distrito: f.distrito, documento: f.documento, correo: f.correo, telefono: f.telefono, mes,
    setup: f.setup, membresia: f.membresia, marketplace: f.marketplace, reservas: f.reservas, torneos: f.torneos, total: f.total,
    estado: "cobrado", cobradoEn: new Date().toISOString(), facturacion: fac
  };
  try {
    await setDoc(doc(db, "cobros", clave), datos);
    E.cobros.push({ id: clave, ...datos });
    aviso("Cobro registrado y enviado a Facturación.", "success");
    pintar("sm-cobros");
  } catch (e) {
    console.error(e);
    await quitarDeFacturacion(fac).catch(() => {});
    aviso("No se pudo registrar el cobro.", "error");
    boton.disabled = false;
  }
}

async function deshacerCobro(clave) {
  const c = E.cobros.find((x) => x.id === clave);
  const ok = await confirmar("¿Deshacer este cobro? Volverá a quedar pendiente y se quitará de Facturación.", "Deshacer", true);
  if (!ok) return;
  try {
    await quitarDeFacturacion(c?.facturacion);
    await deleteDoc(doc(db, "cobros", clave));
    E.cobros = E.cobros.filter((x) => x.id !== clave);
    aviso("Cobro deshecho.", "success");
    pintar("sm-cobros");
  } catch (e) { console.error(e); aviso("No se pudo deshacer.", "error"); }
}

async function guardarTarifasPersonas(boton) {
  const cont = $("smTarifasPersonas");
  let datos;
  try { datos = { torneoInicial: leerParam(cont, "torneoInicial"), torneoInscripcion: leerParam(cont, "torneoInscripcion"), actualizadoEn: new Date().toISOString() }; }
  catch (e) { aviso(e.message, "error"); return; }
  boton.disabled = true;
  try {
    await setDoc(doc(db, "config", "tarifas"), datos);
    E.tarifas = datos;
    aviso("Tarifa guardada. Aplica a los torneos que las Personas publiquen desde ahora.", "success");
    pintar("sm-cobros");
  } catch (e) { console.error(e); aviso("No se pudo guardar la tarifa.", "error"); boton.disabled = false; }
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

function abrirEditorCancha(cancha) {
  const c = cancha || { s: "Tenis", n: "", d: "", a: "", t: [], x: "", activa: true, verificada: false, autorizo: false, destacada: false, notas: "" };
  const distritos = !c.d || DISTRITOS_LIMA.includes(c.d) ? DISTRITOS_LIMA : [c.d, ...DISTRITOS_LIMA];
  const titulo = cancha ? "Editar cancha" : "Nueva cancha";
  const check = (id, val, txt, sub) => `<label class="sm-check"><input type="checkbox" id="${id}" ${val ? "checked" : ""}><span><b>${txt}</b><small>${sub}</small></span></label>`;
  modal(titulo, `
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
  `<button class="btn btn-ghost" data-sm="cerrar-modal">Cancelar</button><button class="btn btn-primary" id="ecGuardar">Guardar</button>`);

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
        const nueva = { ...datos, orden: 10000, creadoEn: datos.actualizadoEn, origen: "creada en el panel" };
        await setDoc(doc(db, "canchas", id), nueva);
        E.canchas.push({ id, ...nueva });
      }
      cerrarModal();
      aviso("Cancha guardada.", "success");
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

// ═════════════════════════ TORNEOS ═════════════════════════
function grupoTorneo(t) {
  if (t.estado === "cancelado") return "cancelados";
  return String(t.fechaInicio) >= hoyISO() ? "vigentes" : "pasados";
}
function organizadorDe(t) {
  if (t.negocioId) { const n = E.negocios.find((x) => x.id === t.negocioId); return { tipo: "Negocio", nombre: n?.nombre || t.creadorNombre || "Negocio" }; }
  const u = E.usuarios.find((x) => x.id === t.creadorId);
  return { tipo: "Persona", nombre: u?.nombre || t.creadorNombre || "Persona" };
}

function vTorneos() {
  const cuenta = (g) => E.torneos.filter((t) => grupoTorneo(t) === g).length;
  const tabs = [["vigentes", "Vigentes"], ["pasados", "Pasados"], ["cancelados", "Cancelados"]];
  return cabecera("SportMatch · Torneos", "Todos los torneos de Personas y Negocios. Ellos los manejan libremente; desde aquí puedes editarlos, cancelarlos o eliminarlos.") + `
    <div class="crm-tabs">${tabs.map(([k, l]) => `<button class="crm-tab ${E.tabTorneos === k ? "active" : ""}" data-sm="tab-torneos" data-tab="${k}">${l} <span class="crm-count">${cuenta(k)}</span></button>`).join("")}</div>
    <div class="filter-bar mb-4">
      <div class="search-wrap"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="search-input" id="smTBuscar" type="search" placeholder="Buscar por torneo, lugar u organizador"></div>
      <select id="smTOrganiza" style="width:auto"><option value="">Organiza: todos</option><option value="Negocio">Negocios</option><option value="Persona">Personas</option></select>
    </div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Torneo</th><th>Organiza</th><th>Fecha</th><th>Inscritos</th><th>Inscripción</th><th>Tarifa SportMatch</th><th>Estado</th><th></th></tr></thead>
      <tbody id="smTablaTorneos"></tbody></table></div></div>`;
}

function pintarTablaTorneos() {
  const tb = $("smTablaTorneos"); if (!tb) return;
  const txt = norm($("smTBuscar")?.value.trim()), org = $("smTOrganiza")?.value;
  const filas = E.torneos.filter((t) => grupoTorneo(t) === E.tabTorneos)
    .map((t) => ({ t, o: organizadorDe(t) }))
    .filter(({ t, o }) => (!org || o.tipo === org) && (!txt || norm(`${t.nombre} ${t.lugar} ${t.distrito} ${o.nombre}`).includes(txt)))
    .sort((a, b) => E.tabTorneos === "vigentes"
      ? String(a.t.fechaInicio + a.t.hora).localeCompare(String(b.t.fechaInicio + b.t.hora))
      : String(b.t.fechaInicio + b.t.hora).localeCompare(String(a.t.fechaInicio + a.t.hora)));
  const estado = (t) => t.estado === "cancelado" ? `<span class="badge badge-red">Cancelado</span>`
    : t.estado === "cerrado" ? `<span class="badge badge-blue">Inscripciones cerradas</span>` : `<span class="badge badge-green">Abierto</span>`;
  tb.innerHTML = filas.length ? filas.map(({ t, o }) => `<tr>
    <td><div class="td-name">${esc(t.nombre)}</div><div class="td-mono">${esc(t.deporte)} · ${t.modalidad === "dobles" ? "Dobles" : "Singles"}${t.visibilidad === "privado" ? " · Privado" : ""} · ${esc(t.distrito || "")}</div></td>
    <td><div class="td-name">${esc(o.nombre)}</div><div class="td-mono">${o.tipo}</div></td>
    <td class="td-mono">${esc(t.fechaInicio)} ${esc(t.hora || "")}</td>
    <td class="td-mono">${fmt((t.inscritos || []).length)} / ${fmt(t.cupos)}${(t.pendientes || []).length ? `<div>${fmt(t.pendientes.length)} por aceptar</div>` : ""}</td>
    <td class="td-mono">${Number(t.precio) ? soles(t.precio) : "Gratis"}</td>
    <td class="td-mono">${esc(textoTarifaTorneo(t.tarifa))}</td>
    <td>${estado(t)}</td>
    <td style="text-align:right;white-space:nowrap">
      <a class="btn btn-ghost btn-sm" href="${URL_APP}/detalle-torneo.html?id=${encodeURIComponent(t.id)}" target="_blank" rel="noopener">Ver ↗</a>
      <button class="btn btn-ghost btn-sm" data-sm="editar-torneo" data-id="${esc(t.id)}">Editar</button>
      ${t.estado !== "cancelado" ? `<button class="btn btn-danger btn-sm" data-sm="cancelar-torneo" data-id="${esc(t.id)}">Cancelar</button>` : ""}
      <button class="btn btn-danger btn-sm" data-sm="eliminar-torneo" data-id="${esc(t.id)}" title="Eliminar">✕</button></td>
  </tr>`).join("") : `<tr><td colspan="8"><div class="sm-vacio">${E.torneos.length ? "No hay torneos con esos filtros." : "Todavía no se ha creado ningún torneo."}</div></td></tr>`;
}

function abrirEditorTorneo(t) {
  if (!t) return;
  const distritos = !t.distrito || DISTRITOS_LIMA.includes(t.distrito) ? DISTRITOS_LIMA : [t.distrito, ...DISTRITOS_LIMA];
  modal("Editar torneo", `
    <div class="form-group"><label class="form-label">Nombre</label><input id="etNombre" maxlength="80" value="${esc(t.nombre)}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Fecha de inicio</label><input type="date" id="etFecha" value="${esc(t.fechaInicio)}"></div>
      <div class="form-group"><label class="form-label">Hora</label><input type="time" id="etHora" value="${esc(t.hora)}"></div>
    </div>
    <div class="form-group"><label class="form-label">Lugar</label><input id="etLugar" maxlength="120" value="${esc(t.lugar)}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Distrito</label><select id="etDistrito">${distritos.map((d) => `<option ${d === t.distrito ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></div>
      <div class="form-group"><label class="form-label">Inscripciones</label><select id="etEstado">
        <option value="abierto" ${t.estado === "abierto" ? "selected" : ""}>Abiertas</option>
        <option value="cerrado" ${t.estado === "cerrado" ? "selected" : ""}>Cerradas</option>
        ${t.estado === "cancelado" ? `<option value="cancelado" selected>Cancelado</option>` : ""}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Cupos</label><input type="number" id="etCupos" min="2" max="128" value="${esc(t.cupos)}"></div>
      <div class="form-group"><label class="form-label">Inscripción (S/)</label><input type="number" id="etPrecio" min="0" step="1" value="${esc(t.precio || 0)}"></div>
    </div>
    <div class="form-group"><label class="form-label">Reglas o detalles</label><textarea id="etDescripcion" rows="3" maxlength="800">${esc(t.descripcion || "")}</textarea></div>
    <div class="section-sub">La tarifa de SportMatch de este torneo (${esc(textoTarifaTorneo(t.tarifa))}) no se cambia: es la que estaba vigente cuando se publicó.</div>
    <div class="login-err" id="etError"></div>`,
  `<button class="btn btn-ghost" data-sm="cerrar-modal">Cancelar</button><button class="btn btn-primary" id="etGuardar">Guardar</button>`);
  $("etGuardar").addEventListener("click", async () => {
    const cambios = {
      nombre: $("etNombre").value.trim(), fechaInicio: $("etFecha").value, hora: $("etHora").value, lugar: $("etLugar").value.trim(),
      distrito: $("etDistrito").value, estado: $("etEstado").value, cupos: Number($("etCupos").value), precio: Number($("etPrecio").value) || 0,
      descripcion: $("etDescripcion").value.trim(), editadoPorAdminEn: new Date().toISOString()
    };
    if (cambios.nombre.length < 4 || !cambios.fechaInicio || !cambios.hora || cambios.lugar.length < 3) { $("etError").textContent = "Completa nombre, fecha, hora y lugar."; return; }
    if (!(cambios.cupos >= 2 && cambios.cupos <= 128)) { $("etError").textContent = "Los cupos deben estar entre 2 y 128."; return; }
    $("etGuardar").disabled = true;
    try {
      await updateDoc(doc(db, "torneos", t.id), cambios);
      Object.assign(t, cambios);
      cerrarModal();
      aviso("Torneo actualizado.", "success");
      pintar("sm-torneos");
    } catch (e) { console.error(e); $("etGuardar").disabled = false; $("etError").textContent = "No se pudo guardar. Inténtalo de nuevo."; }
  });
}

async function cancelarTorneo(id) {
  const t = E.torneos.find((x) => x.id === id);
  const ok = await confirmar(`¿Cancelar <b>${esc(t?.nombre)}</b>?<br><span class="td-mono">Se avisará a las personas inscritas. No se puede deshacer.</span>`, "Cancelar torneo", true);
  if (!ok) return;
  try {
    await updateDoc(doc(db, "torneos", id), { estado: "cancelado", canceladoPorAdminEn: new Date().toISOString() });
    if (t) t.estado = "cancelado";
    aviso("Torneo cancelado.", "success");
    pintar("sm-torneos");
  } catch (e) { console.error(e); aviso("No se pudo cancelar.", "error"); }
}

async function eliminarTorneo(id) {
  const t = E.torneos.find((x) => x.id === id);
  const ok = await confirmar(`¿Eliminar <b>${esc(t?.nombre)}</b> por completo?<br><span class="td-mono">Se borran el torneo y sus inscripciones. No se puede deshacer. Si solo quieres detenerlo, usa Cancelar.</span>`, "Eliminar", true);
  if (!ok) return;
  try {
    const ins = await getDocs(collection(db, "torneos", id, "inscripciones"));
    if (!ins.empty) { const lote = writeBatch(db); ins.forEach((d) => lote.delete(d.ref)); await lote.commit(); }
    await deleteDoc(doc(db, "torneos", id));
    E.torneos = E.torneos.filter((x) => x.id !== id);
    aviso("Torneo eliminado.", "success");
    pintar("sm-torneos");
  } catch (e) { console.error(e); aviso("No se pudo eliminar.", "error"); }
}

// ═════════════════════════ PERSONAS ═════════════════════════
const celular9 = (t) => { const d = String(t || "").replace(/\D/g, "").replace(/^51(?=9\d{8}$)/, ""); return /^9\d{8}$/.test(d) ? d : ""; };
const celularVisible = (d) => (d ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : "");
const primerNombre = (u) => String(u.nombres || u.nombre || "").trim().split(/\s+/)[0] || "";
const MENSAJE_BIENVENIDA = `¡Hola {nombre}! 👋 Soy Italo, de Sports Match. Gracias por crear tu cuenta 🎾

Ya puedes armar partidos, unirte a grupos, inscribirte en torneos y encontrar canchas cerca de ti: ${URL_APP}

Si tienes cualquier duda o idea, escríbeme por aquí. ¡Nos vemos en la cancha!`;
const mensajeBienvenida = () => E.mensajes?.bienvenidaWhatsApp || MENSAJE_BIENVENIDA;

// Cada Persona con sus datos de contacto ya resueltos
function personaCompleta(u) {
  const pr = E.privados[u.id] || {};
  return { u, cel: celular9(pr.telefono), correo: String(pr.correo || "").trim(), novedades: pr.aceptaNovedades === true, bienvenida: E.seguimiento[u.id]?.bienvenidaEn || null };
}
function personasFiltradas() {
  const t = norm($("smUBuscar")?.value.trim()), dis = $("smUDistrito")?.value, est = $("smUEstado")?.value;
  const nov = $("smUNovedades")?.value, bien = $("smUBienvenida")?.value;
  const tDig = String($("smUBuscar")?.value || "").replace(/\D/g, "");
  return E.usuarios.map(personaCompleta).filter(({ u, cel, correo, novedades, bienvenida }) =>
    (!t || norm(u.nombre).includes(t) || norm(correo).includes(t) || (tDig.length >= 3 && cel.includes(tDig))) &&
    (!dis || u.distrito === dis) &&
    (!est || (est === "suspendidos" ? u.suspendido : !u.suspendido)) &&
    (!nov || (nov === "si" ? novedades : !novedades)) &&
    (!bien || (bien === "enviada" ? bienvenida : !bienvenida)))
    .sort((a, b) => String(b.u.creadoEn || "").localeCompare(String(a.u.creadoEn || "")));
}

function vPersonas() {
  const distritos = [...new Set(E.usuarios.map((u) => u.distrito).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  return cabecera("SportMatch · Personas", "Las Personas registradas en la app, con su celular y correo para contactarlas. Estos datos solo los ves tú: las demás Personas de la app no los ven.",
    `<button class="btn btn-ghost btn-sm" data-sm="copiar-correos" title="Copia los correos de quienes aceptaron recibir novedades">✉ Copiar correos</button>
     <button class="btn btn-primary btn-sm" data-sm="csv-personas">⬇ Descargar contactos</button>`) + `
    <div class="filter-bar mb-4">
      <div class="search-wrap"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="search-input" id="smUBuscar" type="search" placeholder="Nombre, correo o celular"></div>
      <select id="smUDistrito" style="width:auto"><option value="">Todos los distritos</option>${distritos.map((d) => `<option>${esc(d)}</option>`).join("")}</select>
      <select id="smUEstado" style="width:auto"><option value="">Activas y suspendidas</option><option value="activos">Activas</option><option value="suspendidos">Suspendidas</option></select>
      <select id="smUNovedades" style="width:auto"><option value="">Novedades: todas</option><option value="si">Aceptan novedades</option><option value="no">No aceptan</option></select>
      <select id="smUBienvenida" style="width:auto"><option value="">Bienvenida: todas</option><option value="pendiente">Bienvenida pendiente</option><option value="enviada">Bienvenida enviada</option></select>
    </div>
    <div class="section-sub mb-4" id="smResumenPersonas"></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Persona</th><th>Contacto</th><th>Distrito</th><th>Deportes</th><th>Actividad</th><th>Novedades</th><th>Bienvenida</th><th>Estado</th><th></th></tr></thead>
      <tbody id="smTablaPersonas"></tbody></table></div></div>
    <div class="section-sub" style="margin-top:12px">Para un correo masivo usa <b>Copiar correos</b> y pégalos en <b>CCO</b> (copia oculta), así nadie ve los correos de los demás. Solo se copian las Personas activas que aceptaron recibir novedades.</div>`;
}

function pintarTablaPersonas() {
  const tb = $("smTablaPersonas"); if (!tb) return;
  const partidos = {}; E.partidos.forEach((p) => { if (p.creadorId) partidos[p.creadorId] = (partidos[p.creadorId] || 0) + 1; });
  const torneos = {}; E.torneos.forEach((x) => { if (!x.negocioId && x.creadorId) torneos[x.creadorId] = (torneos[x.creadorId] || 0) + 1; });
  const filas = personasFiltradas();
  const conNov = filas.filter((f) => f.novedades && !f.u.suspendido && f.correo).length;
  const pend = filas.filter((f) => !f.bienvenida && !f.u.suspendido).length;
  $("smResumenPersonas").textContent = `${fmt(filas.length)} de ${fmt(E.usuarios.length)} personas · ${fmt(conNov)} aceptan novedades · ${fmt(pend)} sin bienvenida`;
  tb.innerHTML = filas.length ? filas.map(({ u, cel, correo, novedades, bienvenida }) => {
    const ini = esc(String(u.nombre || "?").trim().charAt(0).toUpperCase());
    const foto = u.foto && /^https:\/\//.test(u.foto) ? `<img class="sm-avatar" src="${esc(u.foto)}" alt="">` : `<span class="sm-avatar">${ini}</span>`;
    const np = partidos[u.id] || 0, nt = torneos[u.id] || 0;
    return `<tr data-persona="${esc(u.id)}">
      <td><div class="sm-con-avatar">${foto}<div><div class="td-name">${esc(u.nombre || "Sin nombre")}</div><div class="td-mono">Desde ${fechaCorta(u.creadoEn)}</div></div></div></td>
      <td><div class="sm-contacto">
        ${cel ? `<a class="sm-contacto-fila" href="https://wa.me/51${cel}" target="_blank" rel="noopener" title="Escribir por WhatsApp"><span class="sm-ic sm-ic-wa">${ICONO_WA}</span>${celularVisible(cel)}</a>` : `<span class="sm-contacto-fila sm-sin">Sin celular</span>`}
        ${correo ? `<a class="sm-contacto-fila" href="mailto:${esc(correo)}" title="Escribir un correo"><span class="sm-ic">${ICONO_MAIL}</span>${esc(correo)}</a>` : `<span class="sm-contacto-fila sm-sin">Sin correo</span>`}
      </div></td>
      <td>${esc(u.distrito || "—")}</td>
      <td>${esc((u.deportes || []).join(", ") || "—")}</td>
      <td class="td-mono" style="white-space:nowrap">${fmt(np)} ${np === 1 ? "partido" : "partidos"}<br>${fmt(nt)} ${nt === 1 ? "torneo" : "torneos"}</td>
      <td>${novedades ? `<span class="badge badge-green">Acepta</span>` : `<span class="badge badge-gray">No</span>`}</td>
      <td>${bienvenida
        ? `<button class="sm-enviada" data-sm="bienvenida" data-id="${esc(u.id)}" title="Volver a enviar">✓ ${fechaCorta(bienvenida)}</button>`
        : (cel ? `<button class="btn btn-ghost btn-sm sm-btn-wa" data-sm="bienvenida" data-id="${esc(u.id)}"><span class="sm-ic sm-ic-wa">${ICONO_WA}</span>Dar la bienvenida</button>` : `<span class="td-mono">Sin celular</span>`)}</td>
      <td>${u.suspendido ? `<span class="badge badge-red">Suspendida</span>` : `<span class="badge badge-green">Activa</span>`}</td>
      <td style="text-align:right">${u.suspendido
        ? `<button class="btn btn-ghost btn-sm" data-sm="suspender" data-id="${esc(u.id)}" data-valor="no">Reactivar</button>`
        : `<button class="btn btn-danger btn-sm" data-sm="suspender" data-id="${esc(u.id)}" data-valor="si">Suspender</button>`}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="9"><div class="sm-vacio">${E.usuarios.length ? "No hay personas con esos filtros." : "Todavía no hay personas registradas."}</div></td></tr>`;
}

const ICONO_WA = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>`;
const ICONO_MAIL = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;

// ── Bienvenida por WhatsApp (manual): abre WhatsApp con el mensaje listo y la marca como enviada ──
function abrirBienvenida(id) {
  const u = E.usuarios.find((x) => x.id === id); if (!u) return;
  const { cel, bienvenida } = personaCompleta(u);
  if (!cel) return aviso("Esta persona no tiene un celular válido.", "error");
  const nombre = primerNombre(u);
  const texto = mensajeBienvenida().replace(/\{nombre\}/g, nombre);
  modal(`Bienvenida a ${esc(u.nombre || "")}`, `
    ${bienvenida ? `<div class="sm-banner" style="margin-bottom:12px">Ya le diste la bienvenida el ${fechaCorta(bienvenida)}. Puedes volver a enviarla si hace falta.</div>` : ""}
    <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text1)">Mensaje (puedes editarlo antes de enviar)
      <textarea id="smTextoBienvenida" rows="9" style="font-size:13px;line-height:1.6">${esc(texto)}</textarea></label>
    <label class="sm-check" style="margin-top:12px"><input type="checkbox" id="smGuardarMensaje"><span>Usar este mensaje para todas las bienvenidas<small>Donde va el nombre se pondrá el de cada persona.</small></span></label>
    <div class="td-mono" style="margin-top:10px">Se abrirá WhatsApp con el mensaje escrito para ${celularVisible(cel)}. Solo tienes que presionar enviar.</div>`,
    `<button class="btn btn-ghost" data-sm="cerrar-modal">Cancelar</button>
     <button class="btn btn-primary sm-btn-wa" id="smEnviarBienvenida"><span class="sm-ic">${ICONO_WA}</span>Abrir WhatsApp</button>`, 520);
  $("smEnviarBienvenida").addEventListener("click", async () => {
    const final = $("smTextoBienvenida").value.trim();
    if (!final) return aviso("Escribe un mensaje.", "error");
    // Se abre primero (si no, el navegador bloquea la ventana) y luego se guarda
    window.open(`https://wa.me/51${cel}?text=${encodeURIComponent(final)}`, "_blank", "noopener");
    const guardar = $("smGuardarMensaje").checked;
    cerrarModal();
    try {
      const ahora = new Date().toISOString();
      const quien = etraziaAuth()?.currentUser?.email || "";
      await setDoc(doc(db, "seguimientoPersonas", id), { bienvenidaEn: ahora, bienvenidaPor: quien }, { merge: true });
      E.seguimiento[id] = { ...(E.seguimiento[id] || {}), bienvenidaEn: ahora, bienvenidaPor: quien };
      if (guardar) {
        const plantilla = nombre ? final.split(nombre).join("{nombre}") : final;
        await setDoc(doc(db, "config", "mensajes"), { bienvenidaWhatsApp: plantilla }, { merge: true });
        E.mensajes = { ...E.mensajes, bienvenidaWhatsApp: plantilla };
      }
      aviso("Bienvenida marcada como enviada.", "success");
    } catch (e) {
      console.error(e);
      aviso("WhatsApp se abrió, pero no se pudo marcar como enviada. Revisa que las reglas de SportMatch estén publicadas.", "error");
    }
    pintarTablaPersonas();
  });
}

function descargarContactos() {
  const f = personasFiltradas();
  if (!f.length) return aviso("No hay personas con esos filtros.", "error");
  descargarCSV(`sportmatch-contactos-${hoyISO()}.csv`,
    ["Nombre", "Nombres", "Apellidos", "Correo", "Celular", "WhatsApp", "Distrito", "Deportes", "Registro", "Acepta novedades", "Bienvenida", "Estado"],
    f.map(({ u, cel, correo, novedades, bienvenida }) => [u.nombre || "", u.nombres || "", u.apellidos || "", correo, cel ? celularVisible(cel) : "", cel ? `https://wa.me/51${cel}` : "",
      u.distrito || "", (u.deportes || []).join(", "), fechaCorta(u.creadoEn), novedades ? "Sí" : "No", bienvenida ? fechaCorta(bienvenida) : "Pendiente", u.suspendido ? "Suspendida" : "Activa"]));
  aviso(`Se descargaron ${f.length} contactos.`, "success");
}

async function copiarCorreos() {
  const lista = [...new Set(personasFiltradas().filter((f) => f.novedades && !f.u.suspendido && /@/.test(f.correo)).map((f) => f.correo.toLowerCase()))];
  if (!lista.length) return aviso("Ninguna persona de esta lista aceptó recibir novedades todavía.", "error");
  const texto = lista.join(", ");
  try { await navigator.clipboard.writeText(texto); aviso(`Se copiaron ${lista.length} correos. Pégalos en CCO (copia oculta).`, "success"); }
  catch (e) {
    modal("Correos para envío masivo", `<div class="section-sub" style="margin-bottom:8px">Copia este texto y pégalo en <b>CCO</b> (copia oculta).</div>
      <textarea rows="8" readonly style="font-size:12px" onfocus="this.select()">${esc(texto)}</textarea>`, `<button class="btn btn-primary" data-sm="cerrar-modal">Listo</button>`, 520);
  }
}

async function suspenderUsuario(id, suspender) {
  const u = E.usuarios.find((x) => x.id === id);
  const ok = await confirmar(suspender
    ? `¿Suspender a <b>${esc(u?.nombre || "esta persona")}</b>? No podrá entrar a la app hasta que la reactives.`
    : `¿Reactivar a <b>${esc(u?.nombre || "esta persona")}</b>?`, suspender ? "Suspender" : "Reactivar", suspender);
  if (!ok) return;
  try {
    await updateDoc(doc(db, "usuarios", id), { suspendido: suspender, suspendidoEn: suspender ? new Date().toISOString() : null });
    if (u) u.suspendido = suspender;
    aviso(suspender ? "Persona suspendida." : "Persona reactivada.", "success");
    pintarTablaPersonas();
  } catch (e) { console.error(e); aviso("No se pudo actualizar.", "error"); }
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
  if (a === "marcar-cobro") return marcarCobro(b.dataset.clave, b);
  if (a === "deshacer-cobro") return deshacerCobro(id);
  if (a === "ver-cobro") return verDetalleCobro(b.dataset.clave);
  if (a === "guardar-tarifas") return guardarTarifasPersonas(b);
  if (a === "csv-cobros") {
    const f = filasCobros(E.mesCobros);
    return descargarCSV(`sportmatch-cobros-${E.mesCobros}.csv`,
      ["Tipo", "Nombre", "Distrito", "RUC / Documento", "Monto inicial", "Membresía", "Marketplace", "Reservas", "Torneos", "Total", "Estado"],
      f.map((x) => [x.tipo === "negocio" ? "Negocio" : "Persona", x.nombre, x.distrito, x.documento, x.setup, x.membresia, x.marketplace, x.reservas, x.torneos, x.total, x.registro ? "Cobrado" : "Pendiente"]));
  }
  if (a === "editar-torneo") return abrirEditorTorneo(E.torneos.find((t) => t.id === id));
  if (a === "cancelar-torneo") return cancelarTorneo(id);
  if (a === "eliminar-torneo") return eliminarTorneo(id);
  if (a === "tab-torneos") { E.tabTorneos = b.dataset.tab; return pintar("sm-torneos"); }
  if (a === "nueva-cancha") return abrirEditorCancha(null);
  if (a === "editar-cancha") return abrirEditorCancha(E.canchas.find((c) => c.id === id));
  if (a === "reporte-cancha") return abrirReporte(E.canchas.find((c) => c.id === id));
  if (a === "csv-canchas") {
    return descargarCSV(`sportmatch-canchas-${E.mesClics}.csv`,
      ["Deporte", "Nombre", "Distrito", "Dirección", "Teléfonos", "Visible", "Verificada", "Autorizó", "Destacada", `WhatsApp (${E.mesClics})`, "Llamar", "Cómo llegar", "Armar partido", "Total contactos", "Notas"],
      canchasFiltradas().map((c) => { const cl = E.clicsMes[c.id] || {}; return [c.s, c.n, c.d, c.a, (c.t || []).join(" / "), c.activa !== false ? "Sí" : "No", c.verificada ? "Sí" : "No", c.autorizo ? "Sí" : "No", c.destacada ? "Sí" : "No", cl.whatsapp || 0, cl.llamar || 0, cl.mapa || 0, cl.armar || 0, totalClics(cl), c.notas || ""]; }));
  }
  if (a === "suspender") return suspenderUsuario(id, b.dataset.valor === "si");
  if (a === "bienvenida") return abrirBienvenida(id);
  if (a === "csv-personas") return descargarContactos();
  if (a === "copiar-correos") return copiarCorreos();
});

document.addEventListener("input", (e) => {
  if (["smFBuscar", "smFDeporte", "smFDistrito", "smFEstado"].includes(e.target.id)) pintarTablaCanchas();
  if (["smUBuscar", "smUDistrito", "smUEstado", "smUNovedades", "smUBienvenida"].includes(e.target.id)) pintarTablaPersonas();
  if (["smTBuscar", "smTOrganiza"].includes(e.target.id)) pintarTablaTorneos();
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "smFMes") {
    E.mesClics = e.target.value;
    $("smResumenCanchas").textContent = "Cargando contactos…";
    E.clicsMes = await leerClicsMes(E.mesClics);
    pintarTablaCanchas();
  }
  if (e.target.dataset?.sm === "mes-cobros") { E.mesCobros = e.target.value; pintar("sm-cobros"); }
  if (e.target.matches?.("[data-tipo]")) {
    const ayuda = e.target.closest(".sm-param")?.querySelector("[data-ayuda]");
    if (ayuda) ayuda.textContent = e.target.value === "%" ? e.target.dataset.pct : e.target.dataset.monto;
  }
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
