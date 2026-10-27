// ════════════════════════════════════════════════════════════
// Distritos de Sports Match — lista única para toda la app.
// Los 43 distritos de Lima Metropolitana + Callao, con los nombres
// cortos que usa la app (ej. "Surco", "Magdalena").
// Para agregar o cambiar un distrito, edítalo SOLO aquí.
// ════════════════════════════════════════════════════════════
export const DISTRITOS_LIMA = ["Ancón","Ate","Barranco","Breña","Carabayllo","Cercado de Lima","Chaclacayo","Chorrillos","Cieneguilla","Comas","El Agustino","Independencia","Jesús María","La Molina","La Victoria","Lince","Los Olivos","Lurigancho-Chosica","Lurín","Magdalena","Miraflores","Pachacámac","Pucusana","Pueblo Libre","Puente Piedra","Punta Hermosa","Punta Negra","Rímac","San Bartolo","San Borja","San Isidro","San Juan de Lurigancho","San Juan de Miraflores","San Luis","San Martín de Porres","San Miguel","Santa Anita","Santa María del Mar","Santa Rosa","Surco","Surquillo","Villa El Salvador","Villa María del Triunfo","Callao"];

// Agrega todos los distritos como opciones de un <select>
// (respeta la primera opción que ya tenga, ej. "Selecciona" o "Todos").
export function llenarDistritos(select) {
  if (!select) return;
  DISTRITOS_LIMA.forEach((d) => select.add(new Option(d, d)));
}

// Selecciona un distrito; si es uno antiguo que no está en la lista,
// lo agrega para no perder el dato del usuario.
export function asegurarDistrito(select, valor) {
  if (!select) return;
  if (valor && !Array.from(select.options).some((o) => o.value === valor)) {
    select.add(new Option(valor, valor));
  }
  select.value = valor || "";
}
