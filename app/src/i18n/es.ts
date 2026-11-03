// The Spanish text of the UI: the same shape as `en.ts` (a missing or extra key fails the build), in the football
// Spanish of Spain, whose conventions the dates and numbers follow too (see `index.ts`). It speaks to the player as
// "tú", as games in Spanish do. The comments in `en.ts` say what each string is for.
//
// Spanish puts the plural after every number but 1 ("0 cambios", "1 cambio"), and the words after a count agree with
// its noun ("1 cambio aplicado", "3 cambios aplicados"), so the sentences with a count are written out for one and for
// many.

import type { Entity } from "../types";
import type { ErrorTexts, Strings } from "./en";
import { fieldName } from "./fieldNames";

const numbers = new Intl.NumberFormat("es-ES");
const percents = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

/**
 * A count or an amount with the thousands separators of the language: "12.345", but "1234", as Spanish leaves four
 * digits whole.
 */
const format = (value: number) => numbers.format(value);

/** "0 cambios", "1 cambio", "12.345 cambios". */
const changes = (count: number) => (count === 1 ? "1 cambio" : `${format(count)} cambios`);

/** For the places that say how many changes there are, which may be none: "Ningún cambio", "3 cambios". */
const changeCount = (count: number) => (count === 0 ? "Ningún cambio" : changes(count));

/** "1 valor sin tocar", "12 valores sin tocar". */
const valuesLeftAlone = (count: number) =>
  count === 1 ? "1 valor sin tocar" : `${format(count)} valores sin tocar`;

/** What each list holds, for one and for many. Every one of them is masculine, so the words around them are too. */
const nouns: Record<Entity, { one: string; many: string }> = {
  player: { one: "jugador", many: "jugadores" },
  staff: { one: "empleado", many: "empleados" },
  club: { one: "club", many: "clubes" },
};

/** "237 jugadores", "1 empleado", "12 clubes". */
const entityCount = (entity: Entity, count: number) =>
  `${format(count)} ${count === 1 ? nouns[entity].one : nouns[entity].many}`;

const SQUAD_STATUSES: Partial<Record<number, string>> = {
  1: "Jugador estrella",
  2: "Jugador importante",
  3: "Titular habitual",
  4: "Jugador de rotación",
  5: "Revulsivo",
};

/** The name of the field a failure names. */
const field = (key: string | undefined) => fieldName(es, key ?? "");

/** The noun of the kind of record a failure names, or "registro" when it names none. */
const recordNoun = (entity: string | undefined) =>
  entity === "player" || entity === "staff" || entity === "club" ? nouns[entity].one : "registro";

/** The reasons the Rust side gives for a field that cannot be changed some way. */
const UNSUPPORTED: Partial<Record<string, string>> = {
  "a date can only be set": "una fecha solo se puede fijar",
  "it is changed one person at a time": "se cambia persona a persona",
  "the new value is not one of the game's own records of that kind":
    "el nuevo valor no es uno de los registros del propio juego de ese tipo",
};

const reload = "vuelve a leer los datos e inténtalo de nuevo";

/** The lists of a club's staff, as `staff.noRoom` names them. */
const STAFF_DEPARTMENTS: Partial<Record<string, string>> = {
  medical: "del personal médico",
  coaching: "del cuerpo técnico",
  scouting: "de ojeadores",
};

/** The kinds of contract clauses and bonuses, by the codes contracts hold them as (see `en.ts`). */
const CLAUSE_NAMES_ES: Partial<Record<number, string>> = {
  0: "Cláusula de rescisión por traspaso mínimo",
  1: "Cláusula de rescisión por descenso",
  3: "Aumento salarial anual",
  10: "Prima por objetivo de goles en la temporada",
  15: "Rebaja salarial por descenso de primera división",
  19: "Salario tras alcanzar partidos internacionales",
  22: "Ampliación opcional del contrato por parte del club",
  27: "Cláusula de rescisión por traspaso mínimo (clubes en la Copa de Campeones)",
  32: "Prima por partido jugado",
  33: "Prima por gol",
  34: "Prima por portería a cero",
  38: "Prima por suplente no utilizado",
  39: "Prima por asistencia",
  40: "Prima por objetivo de asistencias en la temporada",
};

/** Reasons to be unhappy, by the codes the game keeps them as (see `en.ts`). */
const CONCERN_MOTIVES_ES: Partial<Record<number, string>> = {
  596: "Excluido de la lista de una competición",
  808: "Cree que un compañero ha recibido un trato injusto",
  926: "No cree que un compañero merezca los minutos que quiere",
};

/** Players' traits (preferred moves), by their bit in the game's mask (see `en.ts`). */
const TRAIT_NAMES_ES: readonly string[] = [
  "Conduce el balón por la izquierda",
  "Conduce el balón por la derecha",
  "Conduce el balón por el centro",
  "Se mete en el área rival",
  "Se desmarca a los espacios",
  "Sube al ataque siempre que puede",
  "Juega pases cortos y sencillos",
  "Intenta pases definitivos a menudo",
  "Dispara desde lejos",
  "Dispara con potencia",
  "Coloca los disparos",
  "Golpea con efecto",
  "Le gusta regatear al portero",
  "Le gusta romper el fuera de juego",
  "Usa el exterior del pie",
  "Marca de cerca al rival",
  "Provoca a los rivales",
  "Protesta a los árbitros",
  "Juega de espaldas a la portería",
  "Baja a recibir el balón",
  "Hace paredes",
  "Le gusta hacer vaselinas al portero",
  "Marca el ritmo del juego",
  "Intenta chilenas",
  "Busca el pase antes que el disparo",
  "No juega balones al hueco",
  "Detiene el juego",
  "Se pasa el balón por delante del rival",
  "Se pasa el balón a la derecha antes de regatear",
  "Se pasa el balón a la izquierda antes de regatear",
  "Se recrea con el balón",
  "Llega tarde al área rival",
  "Intenta salir jugando de los apuros",
  "Se queda siempre atrás",
  "Evita usar la pierna mala",
  "Intenta jugadas de fantasía",
  "Intenta faltas lejanas",
  "Se lanza al suelo en las entradas",
  "No se lanza al suelo en las entradas",
  "Recorta hacia dentro",
  "Se pega a la banda",
  "Anima al público",
  "Intenta disparos al primer toque",
  "Intenta pases largos",
  "Le gusta recibir al pie",
  "Lanza las faltas con potencia",
  "Le gusta regatear una y otra vez",
  "Le gusta cambiar el juego a la otra banda",
  "Se retirará en lo más alto",
  "Jugará al fútbol tanto tiempo como pueda",
  "Tiene un saque de banda largo y tenso",
  "Conduce el balón a menudo",
  "Conduce el balón pocas veces",
  "Intenta mejorar la pierna mala",
  "Delantero de referencia estático",
  "Usa el saque de banda largo para iniciar contraataques",
  "Evita los disparos lejanos",
  "Recorta hacia dentro desde la banda izquierda",
  "Recorta hacia dentro desde la banda derecha",
  "Centra pronto",
  "Saca el balón jugado desde la defensa",
  "Juega el balón con los pies",
];

/** What a check is about, from the key a failure gives, with a capital. */
const checkName = (key: string | undefined) => {
  const name = (es.checks as Partial<Record<string, string>>)[key ?? ""] ?? key ?? "";
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** The name of a job code a failure gives, as `jobs` below has it. */
const jobName = (code: string | undefined) => (es.jobs as Partial<Record<number, string>>)[Number(code)] ?? code;

const errors: ErrorTexts = {
  "guard.unknownBuild": () =>
    "FMLibreEditor no se ha probado con esta versión del juego, así que no escribe en ella. «Editar de todos modos», " +
    "en el aviso de arriba, activa la edición.",
  "guard.failed": (p) =>
    `${checkName(p.check)}: no han superado las comprobaciones en esta versión del juego, así que FMLibreEditor no ` +
    "los cambia.",
  "edit.unknownField": (p) => `Aquí no hay ningún campo editable llamado «${p.field}».`,
  "edit.outOfRange": (p) => `${p.value} no es un valor válido para ${field(p.field)}: admite de ${p.min} a ${p.max}.`,
  "edit.notADate": (p) => `${p.value} no es una fecha válida para ${field(p.field)}.`,
  "edit.notAChoice": (p) => `${p.value} no es uno de los valores que admite ${field(p.field)}.`,
  "edit.taken": (p) => `El dorsal ${p.value} está ocupado: lo lleva ${p.name ?? `el jugador con UID ${p.uid}`}.`,
  "edit.unsupported": (p) => `${field(p.field)} no se puede cambiar así: ${UNSUPPORTED[p.reason] ?? p.reason}.`,
  "edit.moved": (p) => `Este ${recordNoun(p.entity)} ha cambiado de sitio en la memoria del juego; ${reload}.`,
  "edit.noRecord": (p) => `${field(p.field)} no se puede cambiar aquí: su registro falta o no supera la comprobación.`,
  "edit.unset": (p) => `${field(p.field)} no está fijado en el juego, así que no se ha tocado.`,
  "edit.implausible": (p) =>
    `${field(p.field)} marca ${p.value}, un valor que no puede tener; por seguridad, no se ha tocado.`,
  "edit.notApplied": (p) => `${field(p.field)}: se escribió ${p.wrote}, pero al releerlo dio ${p.read}.`,
  "edit.conflict": (p) =>
    `${field(p.field)} vale ahora ${p.found}, no ${p.expected}: el juego lo ha cambiado desde entonces.`,
  "move.moved": () => `El jugador ha cambiado de sitio en la memoria del juego; ${reload}.`,
  "move.notAClub": () => "Este club no tiene un primer equipo al que pueda unirse el jugador.",
  "move.freeAgent": () => "El jugador no tiene club; los agentes libres aún no se pueden traspasar.",
  "move.sameClub": () => "El jugador ya está en este club.",
  "move.onLoan": () => "El jugador está cedido; los jugadores cedidos aún no se pueden traspasar.",
  "move.playerCoach": () => "Los jugadores-entrenadores no se pueden traspasar: también trabajan como personal.",
  "move.unusualContract": () => "El contrato del jugador no es un contrato de jugador corriente.",
  "move.humanClub": () =>
    "El jugador está en un club que dirige un mánager humano. Las tácticas y el entrenamiento del club también " +
    "apuntan a él, así que solo puede salir del club desde el propio juego.",
  "move.menAndWomen": () => "Uno de los clubes es masculino y el otro, femenino.",
  "move.notListed": () => "Las listas de la plantilla no tienen al jugador donde deberían.",
  "move.noRoom": (p) =>
    `La lista de la plantilla del club no tiene sitio para otro jugador (ahora ${p.players}) y el editor no puede ` +
    "ampliarla.",
  "move.outOfRange": (p) => `${p.value} no es un valor válido para ${field(p.field)}: admite de ${p.min} a ${p.max}.`,
  "move.changed": () => `El juego ha cambiado esa memoria desde entonces; ${reload}.`,
  "move.notApplied": () => "Se escribió en la memoria, pero al releerla dio otra cosa.",
  "heal.notInjured": () => "El jugador no tiene ninguna lesión que curar.",
  "ban.notBanned": () => "El jugador no tiene ninguna sanción que levantar.",
  "relation.missing": () => `Esa nacionalidad o formación ya no está en la lista del jugador; ${reload}.`,
  "relation.noRoom": () =>
    "La lista del jugador no tiene sitio y el editor no puede ampliarla; cambia una de sus entradas en su lugar.",
  "relation.target": () => "No es un país ni un club del juego del tipo que admite esta entrada.",
  "relation.same": () => "El jugador ya tiene eso.",
  "relation.rule": (p) => `La regla de formación local ${p.rule} no es de las que escribe el editor.`,
  "staff.you": () => "Eres tú, el mánager que controlas.",
  "staff.unemployed": () => "Este miembro del personal no tiene club.",
  "staff.role": () =>
    "El club o uno de sus equipos apunta directamente a este miembro del personal (como un equipo a su mánager); " +
    "de moverlo se encarga el propio juego.",
  "staff.notListed": () => "Las listas de personal del club no lo tienen donde deberían.",
  "staff.noRoom": (p) =>
    `La lista ${STAFF_DEPARTMENTS[p.department] ?? `de ${p.department}`} del club no tiene sitio para nadie más ` +
    `(ahora ${p.staff}) y el editor no puede ampliarla.`,
  "staff.job": (p) => `El editor todavía no mueve al personal con el puesto de ${jobName(p.job)} ni da ese puesto.`,
  "squad.noTeam": () => `El club no tiene ese equipo o no supera la comprobación; ${reload}.`,
  "captain.notInTeam": () =>
    "El jugador no juega en este equipo; el capitán solo puede ser uno de los jugadores del propio equipo.",
  "captain.unchanged": () => "El jugador ya tiene ese papel.",
  "session.notRunning": () =>
    "Football Manager 27 no se está ejecutando. Inicia el juego, carga una partida y vuelve a intentarlo.",
  "session.noSuchProcess": (p) => `No hay ningún ${p.exe ?? "fm.exe"} con el PID ${p.pid}.`,
  "session.severalRunning": (p) => `Hay ${p.count} copias de ${p.exe ?? "fm.exe"} en ejecución (${p.pids}); elige una.`,
  "session.pluginNotLoaded": () =>
    "Los datos del juego aún no se han cargado; espera al menú principal y vuelve a intentarlo.",
  "session.unsupportedEdition": (p) => `FM${p.edition} aún no es compatible.`,
  "session.unknownEdition": () => "No se ha podido saber qué Football Manager es este.",
  "session.playersNotFound": () =>
    "No se ha encontrado la lista de jugadores; carga una partida (el menú principal no basta) y vuelve a intentarlo.",
  "memory.win32": (p) => `Windows ha rechazado una operación (${p.operation}, error ${p.code}).`,
  "memory.read": (p) => `No se ha podido leer la memoria del juego (error del sistema ${p.code}).`,
  "memory.write": (p) => `No se ha podido escribir en la memoria del juego (error del sistema ${p.code}).`,
  "memory.readOnly": () => "El juego se abrió solo para lectura; Windows no ha permitido escribir.",
  "memory.notWritable": () =>
    "Esa dirección no está en la memoria de datos modificable del juego, así que no se ha escrito.",
  "memory.invalidPe": () => "No se ha podido leer el módulo del juego.",
  "memory.invalidMachO": () => "No se ha podido leer el módulo del juego.",
  "memory.mach": (p) => `macOS ha rechazado una operación (${p.operation}, error ${p.code}).`,
  "memory.posix": (p) => `macOS ha rechazado una operación (${p.operation}, errno ${p.code}).`,
  "memory.noBridge": () =>
    "macOS no deja entrar a FMLibreEditor en el juego: el juego se inició sin el puente de FMLibreEditor. " +
    "Instala el puente y vuelve a iniciar el juego desde Steam.",
  "memory.bridge": (p) => `El puente de FMLibreEditor en el juego no ha entregado la memoria (${p.reason}).`,
  "setup.steamRunning": () =>
    "Steam está abierto, así que no se han tocado las opciones de lanzamiento de FM27; el puente en sí está " +
    "instalado. Cierra Steam y vuelve a intentarlo, o introduce tú la opción de lanzamiento en Steam.",
  "setup.noSteamAccount": () =>
    "No se ha encontrado ninguna cuenta de Steam en este Mac; abre Steam e inicia sesión una vez.",
  "setup.noLibrary": (p) => `Falta un archivo del puente en la aplicación: ${p.path}`,
  "setup.unknownConfig": (p) => `${p.path} no tiene un formato que FMLibreEditor conozca, así que no se ha tocado.`,
  "setup.io": (p) => `${p.path}: ${p.error}`,
  "app.internal": () => "Se ha producido un error inesperado en la aplicación.",
  "app.notConnected": () => "No hay conexión con el juego.",
  "app.notFound": (p) =>
    `No hay ningún ${recordNoun(p.entity)} con el ID ${p.uid} en las listas; vuelve a leer los datos.`,
  "app.dataChanged": () => `Estos datos han cambiado en el juego; ${reload}.`,
  "app.noChange": (p) => `No existe el cambio ${p.id}.`,
  "app.alreadyUndone": () => "Este cambio ya se ha deshecho.",
  "export.failed": (p) => `No se ha podido escribir el archivo: ${p.reason}`,
  "export.noFolder": () => "No hay ninguna carpeta a la que exportar.",
  "export.notExported": () => "Ese no es un archivo que haya exportado FMLibreEditor.",
  "export.openFailed": (p) => `No se ha podido abrir: ${p.reason}`,
  "mass.noOperations": () => "Elige al menos un campo que cambiar.",
  "mass.tooMany": (p) =>
    `Hay ${p.count} resultados. Para una edición masiva, acota la búsqueda o los filtros a ${p.limit} como máximo.`,
  "mass.outOfDate": () => "Esta vista previa está desfasada. Vuelve a generar la vista previa de la edición masiva.",
};

export const es: Strings = {
  attributes: {
    // Técnicos
    corners: "Saques de esquina",
    crossing: "Centros",
    dribbling: "Regate",
    finishing: "Remate",
    first_touch: "Control",
    free_kicks: "Lanzamiento de faltas",
    heading: "Cabeceo",
    long_shots: "Tiros lejanos",
    long_throws: "Saque de banda largo",
    marking: "Marcaje",
    passing: "Pases",
    penalty_taking: "Penaltis",
    tackling: "Entradas",
    technique: "Técnica",
    // Mentales
    aggression: "Agresividad",
    anticipation: "Anticipación",
    bravery: "Valentía",
    composure: "Serenidad",
    concentration: "Concentración",
    decisions: "Decisiones",
    determination: "Determinación",
    flair: "Talento",
    leadership: "Liderazgo",
    off_the_ball: "Desmarques",
    positioning: "Colocación",
    teamwork: "Juego en equipo",
    vision: "Visión",
    work_rate: "Sacrificio",
    // Físicos
    acceleration: "Aceleración",
    agility: "Agilidad",
    balance: "Equilibrio",
    jumping_reach: "Alcance de salto",
    natural_fitness: "Recuperación física",
    pace: "Velocidad",
    stamina: "Resistencia",
    strength: "Fuerza",
    // Portero (el control y los pases son los de Técnicos)
    aerial_reach: "Alcance aéreo",
    command_of_area: "Mando en el área",
    communication: "Comunicación",
    eccentricity: "Excentricidad",
    handling: "Blocaje",
    kicking: "Saque con el pie",
    one_on_ones: "Uno contra uno",
    punching: "Despeje de puños (tendencia)",
    reflexes: "Reflejos",
    rushing_out: "Salidas (tendencia)",
    throwing: "Saque con la mano",
    // Ocultos
    consistency: "Regularidad",
    dirtiness: "Juego sucio",
    important_matches: "Partidos importantes",
    injury_proneness: "Propensión a lesiones",
    versatility: "Versatilidad",
    // Pies
    left_foot: "Pie izquierdo",
    right_foot: "Pie derecho",
  },

  staffAttributes: {
    // Entrenamiento
    attacking: "Ataque",
    defending: "Defensa",
    fitness: "Preparación física",
    goalkeeping: "Porteros",
    possession: "Posesión",
    set_pieces: "Balón parado",
    tactical: "Táctica",
    technical: "Técnica",
    working_with_youngsters: "Trabajo con jóvenes",
    // Mentales
    authority: "Autoridad",
    determination: "Determinación",
    motivating: "Motivación",
    people_management: "Gestión de personas",
    // Conocimientos
    data_analysis: "Análisis de datos",
    judging_ability: "Valorar la calidad de jugadores",
    judging_potential: "Valorar el potencial de jugadores",
    judging_staff: "Valorar la calidad del personal",
    negotiating: "Negociación",
    tactical_knowledge: "Conocimiento táctico",
    // Médicos
    physiotherapy: "Fisioterapia",
    sports_science: "Ciencias del deporte",
  },

  personality: {
    adaptability: "Adaptabilidad",
    ambition: "Ambición",
    loyalty: "Lealtad",
    pressure: "Presión",
    professionalism: "Profesionalidad",
    sportsmanship: "Deportividad",
    temperament: "Temperamento",
    controversy: "Controversia",
  },

  positions: {
    gk: "GK",
    sw: "SW",
    dl: "DL",
    dc: "DC",
    dr: "DR",
    dm: "DM",
    ml: "ML",
    mc: "MC",
    mr: "MR",
    aml: "AML",
    amc: "AMC",
    amr: "AMR",
    st: "ST",
    wbl: "WBL",
    wbr: "WBR",
  },

  clubFacilities: {
    training: "Entrenamiento",
    youth_facilities: "Instalaciones de cantera",
    youth_coaching: "Formación en la cantera",
    youth_recruitment: "Captación de cantera",
    corporate: "Corporativas",
  },

  supporterTraits: {
    loyalty: "Lealtad",
    passion: "Pasión",
    patience: "Paciencia",
    affluence: "Poder adquisitivo",
    temperament: "Temperamento",
    expectations: "Expectativas",
  },

  supporterMix: {
    hardcore: "Incondicionales",
    core: "Habituales",
    family: "Familias",
    fair_weather: "Oportunistas",
    casual: "Ocasionales",
    other: "Otros",
  },

  jobs: {
    1: "Jugador",
    2: "Entrenador",
    4: "Presidente",
    6: "Directivo",
    12: "Fisioterapeuta",
    14: "Ojeador",
    16: "Mánager",
    20: "Segundo entrenador",
    22: "Entrenador de balón parado",
    26: "Preparador físico",
    34: "Entrenador de porteros",
    40: "Jefe de ciencias del deporte",
    44: "Jefe de ojeadores",
    48: "Científico deportivo",
    50: "Fisioterapeuta jefe",
    58: "Analista de captación",
    60: "Analista de rendimiento",
    64: "Director de cantera",
    70: "Presidente del club",
    86: "Gestor de cesiones",
    88: "Director técnico",
  },

  fields: {
    current_ability: "Habilidad actual",
    potential_ability: "Habilidad potencial",
    height: "Altura (cm)",
    date_of_birth: "Fecha de nacimiento",
    asking_price: "Precio de venta",
    nation: "Nacionalidad",
    "reputation.home": "Reputación local",
    "reputation.current": "Reputación actual",
    "reputation.world": "Reputación mundial",
    "international.caps": "Partidos internacionales",
    "international.goals": "Goles internacionales",
    "international.u21_caps": "Partidos sub-21",
    "international.u21_goals": "Goles sub-21",
    condition: "Energía",
    match_sharpness: "Ritmo de competición",
    jadedness: "Fatiga",
    morale: "Moral",
    "contract.wage": "Salario semanal",
    "contract.loyalty_bonus": "Prima de fidelidad semanal",
    "contract.happiness": "Felicidad",
    "contract.playing_time_happiness": "Felicidad con los minutos",
    "contract.unhappiness": "Motivos de descontento",
    "contract.expires": "Fin de contrato",
    "contract.squad_number": "Dorsal",
    "contract.squad_status": "Estatus en la plantilla",
    "contract.transfer_listed": "Transferible",
    "contract.loan_listed": "Cedible",
    "contract.job": "Puesto",
    "tie.nationality": "Nacionalidad secundaria",
    "tie.trainedInNation": "Formado en el país",
    "tie.trainedAtClub": "Formado en el club",
    club: "Club",
    injuries: "Lesiones",
    bans: "Sanciones",
    retirement: "Retirada",
    clause: "Cláusula del contrato",
    "clause.amount": "Importe de la cláusula",
    "clause.condition": "Condición de la cláusula",
    captain: "Capitán",
    vice_captain: "Vicecapitán",
    reputation: "Reputación",
    "facilities.training": "Instalaciones de entrenamiento",
    "facilities.youth_facilities": "Instalaciones de cantera",
    "facilities.youth_coaching": "Formación en la cantera",
    "facilities.youth_recruitment": "Captación de cantera",
    "facilities.corporate": "Instalaciones corporativas",
    "finance.balance": "Saldo",
    "finance.transfer_budget": "Presupuesto de fichajes",
    "finance.wage_budget": "Presupuesto salarial",
    "finance.total_wage_budget": "Presupuesto salarial total",
    "stadium.capacity": "Aforo del estadio",
    "stadium.seating": "Aforo con asientos",
    "stadium.used": "Aforo en uso",
    "stadium.expansion": "Aforo ampliable",
  },

  profile: {
    close: "Cerrar perfil",
    loading: "Cargando perfil…",
    resize: "Cambiar el ancho del panel del perfil",
    resizeHint: "Arrastra para ensanchar o estrechar el panel; haz doble clic para devolverle su ancho",
    none: "—",

    // Cabecera
    freeAgent: "Agente libre",
    born: "Nacimiento:",
    height: (cm) => `${cm} cm`,
    heightUnit: "cm",
    uid: "UID",
    currentAbility: "Habilidad actual",
    currentAbilityShort: "HA",
    potentialAbility: "Habilidad potencial",
    potentialAbilityShort: "HP",
    potentialRange: "Potencial fijado como un rango",

    // Atributos
    technical: "Técnicos",
    goalkeeping: "Portero",
    mental: "Mentales",
    physical: "Físicos",
    hidden: "Ocultos",
    feet: "Pies",
    personality: "Personalidad",
    raw: (raw, scale = 100) => `valor interno ${raw} / ${scale}`,
    lowerIsBetter: "cuanto más bajo, mejor",
    age: (age) => `${age} años`,

    // Posiciones
    positions: "Posiciones",
    positionsSummary: (best) => `Valoraciones por posición: ${best}`,
    positionRatings: "Valoraciones por posición",
    positionTiers: {
      natural: "Natural",
      accomplished: "Hábil",
      competent: "Competente",
      unconvincing: "Poco convincente",
      ineffective: "Ineficaz",
    },
    positionTooltip: (position, rating, tier) => `${position} · ${rating} · ${tier}`,

    // Contrato
    contract: "Contrato",
    wage: "Salario semanal",
    wageNote: (converted) =>
      converted
        ? "el juego guarda libras; se muestra al cambio del propio FM"
        : "el juego guarda libras; puedes elegir otra moneda en los ajustes",
    signed: "Firmado",
    expires: "Vence",
    joined: "Incorporación",
    squadStatus: "Estatus en la plantilla",
    squadStatusName: (status) => SQUAD_STATUSES[status] ?? `Estatus ${status}`,
    squadNumber: "Dorsal",
    transferListed: "Transferible",
    loanListed: "Cedible",

    // Trayectoria
    career: "Trayectoria",
    internationalCaps: "Partidos internacionales",
    internationalGoals: "Goles internacionales",
    u21Caps: "Partidos sub-21",
    u21Goals: "Goles sub-21",
    askingPrice: "Precio de venta",
    notSet: "Sin fijar",
    reputation: "Reputación",
    reputationHome: "Local",
    reputationCurrent: "Actual",
    reputationWorld: "Mundial",
    retirement: "Retirada",
    retires: "Prevé retirarse",
    noRetirement: "El juego no ha previsto su retirada",
    keepPlaying: "Evitar la retirada",
    keepingPlaying: "Evitando…",
    keepPlayingTitle:
      "Quita su retirada de los planes del juego y le da la característica «Jugará al fútbol tanto tiempo como " +
      "pueda» en lugar de «Se retirará en lo más alto»; se puede deshacer en Cambios",

    // Médico
    morale: (value) => `${value} / 20`,
    traits: "Características",
    noTraits: "Sin características",
    traitName: (bit) => TRAIT_NAMES_ES[bit] ?? `Característica ${bit}`,
    unhappiness: "Descontento",
    noUnhappiness: "Nada le hace estar descontento",
    removeUnhappiness: "Quitar todo",
    removingUnhappiness: "Quitando…",
    removeUnhappinessTitle:
      "Quita de su lista todos los motivos de descontento, como hace Quitar todo en FMRTE; se puede deshacer en Cambios",
    concernSince: (date) => `desde el ${date}`,
    concernKind: (kind) => (kind === 1 ? "Preocupado" : kind === 2 ? "Interno" : `Tipo ${kind}`),
    concernMotive: (motive) => CONCERN_MOTIVES_ES[motive] ?? `Motivo ${motive}`,
    clauses: "Primas y cláusulas",
    noClauses: "Sin primas ni cláusulas",
    loyaltyBonus: "Prima de fidelidad",
    happiness: "Felicidad",
    playingTimeHappiness: "Felicidad con los minutos",
    moodTitle: "Como lo muestra FMRTE, de -100 a 100; el juego lo muestra con palabras",
    clauseName: (kind) => CLAUSE_NAMES_ES[kind] ?? `Cláusula ${kind}`,
    clauseCondition: (kind, value) => {
      switch (kind) {
        case 10:
          return value === 1 ? "1 gol" : `${format(value)} goles`;
        case 40:
          return value === 1 ? "1 asistencia" : `${format(value)} asistencias`;
        case 19:
          return value === 1 ? "1 partido internacional" : `${format(value)} partidos internacionales`;
        case 22:
          return value === 1 ? "1 año" : `${format(value)} años`;
        case 3:
        case 15:
          return `${value} %`;
        default:
          return String(value);
      }
    },
    moraleTitle:
      "El juego muestra la moral como la felicidad general del jugador: satisfecho con 10, algo feliz con 11, " +
      "extremadamente feliz con 15 y 20",
    jadednessTitle:
      "Cuánto desgaste acumula el jugador por jugar, que el descanso reduce: -500 es estar totalmente descansado y, " +
      "cuanto más alto, más necesita un descanso",
    noInjuries: "Sin lesiones",
    unknownInjury: "Lesión desconocida",
    injuryStarted: (date) => `Desde el ${date}`,
    injuryBack: (dates) => `Regreso previsto: ${dates}`,
    heal: "Curar",
    healTitle: "Curar todas las lesiones de este jugador en el juego",
    noBans: "Sin sanciones",
    banMatches: (matches) => (matches === 1 ? "1 partido" : `${format(matches)} partidos`),
    banStarted: (date) => `Desde el ${date}`,
    liftBans: "Levantar",
    liftBansTitle: "Levantar todas las sanciones de este jugador en el juego",

    // Sobre los atributos, mientras se lee el perfil
    maxAttributes: "Atributos al máximo",
    maxAttributesTitle:
      "Poner cada atributo de este jugador en su mejor valor: 20, y 1 para la propensión a lesiones y el juego sucio",
    maxAttributesDone: (count) =>
      count === 0
        ? "Todos sus atributos ya están en su mejor valor"
        : count === 1
          ? "1 cambio escrito"
          : `${format(count)} cambios escritos`,
    maxAttributesUndone: (count) =>
      count === 0 ? "No se ha deshecho nada" : count === 1 ? "1 cambio deshecho" : `${format(count)} cambios deshechos`,
    undoMax: "Deshacer",
    undoMaxTitle: "Volver a escribir en el juego sus atributos anteriores",
    freezeAttributes: "Congelar los atributos",
    freezeAttributesNote:
      "Mientras la aplicación esté abierta y conectada, sus atributos no empeoran: lo que el juego quita se devuelve, " +
      "y las mejoras siguen contando. La aplicación lo recuerda para esta partida y vuelve a congelarlos al " +
      "conectarse a ella.",

    // Personal
    you: "Tú",
    youTitle: "El mánager que controlas en esta partida",
    id: "ID",
    job: "Puesto",
    changeJob: "Cambiar de puesto",
    changeJobTitle: "Dar a este miembro del personal otro puesto en su club en el juego",
    newJob: "Nuevo puesto",
    applyJob: "Aplicar",
    cancelJob: "Cancelar",
    unemployed: "Sin empleo",
    coaching: "Entrenamiento",
    knowledge: "Conocimientos",
    medical: "Médico",
    playerCoach: (job) => `${job} (jugador-entrenador)`,
    unknownJob: (code) => `Puesto ${code}`,
  },

  playerList: {
    nav: "Jugadores",
    count: (total) => entityCount("player", total),
    search: "Buscar jugadores por nombre o UID",
    summary: (total, shown, sorted) => {
      const count = entityCount("player", total);
      if (total <= shown) {
        return count;
      }
      return sorted === null
        ? `${count} · se muestran los ${shown} mejores por habilidad actual`
        : `${count} · se muestran los ${shown} primeros por ${sorted.by}, en orden ` +
            (sorted.ascending ? "ascendente" : "descendente");
    },
    empty: (query, filtered) => {
      if (query === "") {
        return filtered ? "Ningún jugador coincide con estos filtros." : "No se han encontrado jugadores.";
      }
      return filtered
        ? `Ningún jugador coincide con «${query}» con estos filtros.`
        : `Ningún jugador coincide con «${query}».`;
    },
    columns: {
      name: "Nombre",
      age: "Edad",
      positions: "Posiciones",
      nation: "País",
      club: "Club",
      contractExpires: "Contrato",
      born: "Nacimiento",
      currentAbility: "HA",
      potentialAbility: "HP",
      uid: "UID",
    },
    sortBy: (by) => `Ordenar por ${by}`,
    sortNames: {
      currentAbility: "habilidad actual",
      potentialAbility: "habilidad potencial",
      age: "edad",
      name: "nombre",
      nation: "país",
      club: "club",
      contractExpires: "fin de contrato",
    },
    filters: {
      toggle: "Filtros",
      toggleActive: (count) => (count === 1 ? "Filtros, 1 activo" : `Filtros, ${count} activos`),
      clear: "Borrar",
      any: "Cualquiera",
      position: "Posición",
      age: "Edad",
      minAge: "Edad mínima",
      maxAge: "Edad máxima",
      minPlaceholder: "Mín.",
      maxPlaceholder: "Máx.",
      minCurrentAbility: "HA mín.",
      minCurrentAbilityTitle: "Habilidad actual mínima",
      minPotentialAbility: "HP mín.",
      minPotentialAbilityTitle: "Habilidad potencial mínima",
      abilityPlaceholder: "1–200",
      nation: "País",
      club: "Club",
      freeAgentsOnly: "Solo agentes libres",
      contractEndsBy: "Contrato hasta",
      transferListedOnly: "Solo transferibles",
      loanListedOnly: "Solo cedibles",
      attributes: {
        heading: "Atributos",
        attribute: "Atributo",
        pick: "Elige un atributo",
        min: (name) => (name ? `${name}: mínimo` : "Mínimo"),
        max: (name) => (name ? `${name}: máximo` : "Máximo"),
        add: "Añadir atributo",
        remove: (name) => (name ? `Quitar ${name}` : "Quitar esta fila"),
      },
      saved: {
        save: "Guardar",
        saveTitle: "Guardar con un nombre los filtros y el orden actuales",
        name: "Nombre del filtro guardado",
        namePlaceholder: "Nombre del filtro",
        ok: "Aceptar",
        cancel: "Cancelar",
        select: "Filtros guardados",
        delete: "Eliminar",
        deleteTitle: (name) => `Eliminar el filtro guardado: ${name}`,
        replaceQuestion: (name) => `Ya hay un filtro guardado llamado «${name}». ¿Reemplazarlo?`,
        replace: "Reemplazar",
        full: (max) =>
          `Se pueden guardar hasta ${max} filtros. Elimina uno antes, o usa el nombre de un filtro guardado para ` +
          "reemplazarlo.",
      },
    },
  },

  staffList: {
    nav: "Personal",
    count: (total) => entityCount("staff", total),
    search: "Buscar personal por nombre o ID",
    summary: (total, shown) =>
      total > shown
        ? `${entityCount("staff", total)} · se muestran los ${shown} mejores por habilidad actual`
        : entityCount("staff", total),
    empty: (query, filtered) => {
      if (query === "") {
        return filtered ? "Ningún empleado coincide con estos filtros." : "No se ha encontrado personal.";
      }
      return filtered
        ? `Ningún empleado coincide con «${query}» con estos filtros.`
        : `Ningún empleado coincide con «${query}».`;
    },
    columns: {
      name: "Nombre",
      age: "Edad",
      job: "Puesto",
      club: "Club",
      nation: "País",
      born: "Nacimiento",
      currentAbility: "HA",
      potentialAbility: "HP",
      id: "ID",
    },
    filters: {
      job: "Puesto",
      anyJob: "Cualquiera",
      unemployedOnly: "Solo sin empleo",
    },
  },

  clubProfile: {
    // Cabecera
    womensClub: "Club femenino",
    founded: (year) => `Fundado en ${year}`,
    reputationShort: "REP",
    reputationTitle: "Reputación",

    tabsLabel: "Secciones del club",
    tabs: { overview: "Resumen", squad: "Plantilla" },
    squadLocked: "Termina de editar para abrir la plantilla",

    facilities: "Instalaciones",

    // Afición
    supporters: "Afición",
    supporterMix: "Tipos de aficionados",
    percent: (value) => `${percents.format(value)} %`,
    mixTooltip: (kind, percent) => `${kind} · ${percent}`,

    // Finanzas
    finances: "Finanzas",
    balance: "Saldo",
    transferBudget: "Presupuesto de fichajes",
    wageBudget: "Presupuesto salarial (gasto)",
    totalWageBudget: "Presupuesto salarial total",
    ticketPrice: "Precio medio de la entrada",
    perWeek: "por semana",
    noFinances: "FM solo guarda las finanzas de los clubes de las ligas en juego.",
    freeze: "Congelar el dinero",
    freezeNote:
      "Mientras la aplicación esté abierta y conectada, el saldo no baja: lo que el juego quita se devuelve, y los " +
      "ingresos siguen contando. La aplicación lo recuerda para esta partida y vuelve a congelarlo al conectarse a ella.",

    // Estadio
    stadium: "Estadio",
    capacity: "Aforo",
    seating: "Con asientos",
    used: "En uso",
    usedAll: "Todo",
    usedTitle:
      "La parte del aforo que el juego deja usar cuando la limita (por ejemplo, con asientos cerrados); 0 significa " +
      "todo",
    expansion: "Ampliable hasta",
    noStadium: "No se ha podido leer el estadio de este club.",

    // Datos del club
    info: "Datos del club",
    seasonTickets: "Abonos de temporada",
    socialMedia: "Seguidores en redes sociales",
  },

  clubList: {
    nav: "Clubes",
    count: (total) => entityCount("club", total),
    search: "Buscar clubes por nombre o UID",
    summary: (total, shown) =>
      total > shown
        ? `${entityCount("club", total)} · se muestran los ${shown} primeros por reputación`
        : entityCount("club", total),
    empty: (query, filtered) => {
      if (query === "") {
        return filtered ? "Ningún club coincide con este filtro." : "No se han encontrado clubes.";
      }
      return filtered
        ? `Ningún club coincide con «${query}» con este filtro.`
        : `Ningún club coincide con «${query}».`;
    },
    women: "Femenino",
    columns: {
      name: "Nombre",
      reputation: "Reputación",
      founded: "Fundación",
      uid: "UID",
    },
    filters: {
      kind: "Clubes que mostrar",
      all: "Todos los clubes",
      men: "Clubes masculinos",
      women: "Clubes femeninos",
    },
  },

  app: {
    stage: "beta",
    settingsLabel: "Ajustes",
    languageLabel: "Idioma",
    currencyLabel: "Moneda",

    noteEditable:
      "Los cambios solo llegan al juego cuando los aplicas. Haz antes una copia de seguridad de tu partida.",
    noteReadOnly: "Solo lectura: Windows no ha permitido a FMLibreEditor escribir en el juego.",
    noteUnknownBuild: "Solo lectura: esta versión del juego es nueva para FMLibreEditor.",
    noteNotConnected: "Nada cambia en el juego hasta que editas y aplicas.",

    notConnected: "Sin conexión",
    previewTag: "vista previa en el navegador · datos de ejemplo",
    noDate: "Sin fecha del juego",
    noDateTitle:
      "FMLibreEditor no pudo leer la fecha del juego en esta versión del juego, así que no se muestran las edades y " +
      "los filtros de edad no encuentran a nadie. Busca actualizaciones.",
    reload: "Recargar datos",
    refresh: "Actualizar",
    detecting: "Buscando Football Manager…",
    connecting: "Leyendo jugadores, personal y clubes…",
    reloading: "Recargando jugadores, personal y clubes…",

    refrozen: {
      title: "Congelado de nuevo desde la última vez",
      waitingTitle: "Lo congelado espera por ahora",
      players: (names) => `Atributos: ${names}`,
      clubs: (names) => `Dinero: ${names}`,
      more: (count) => `y ${format(count)} más`,
      waiting: (count) =>
        `${count === 1 ? "1 sigue recordado" : `${format(count)} siguen recordados`}, pero no se congelan ahora: ` +
        "FMLibreEditor aún no puede escribir en esta versión del juego.",
      dismiss: "Cerrar",
    },

    connect: {
      title: "Conectar con Football Manager 27",
      intro:
        "FMLibreEditor lee la memoria del juego mientras se ejecuta. Inicia el juego y carga una partida; después, " +
        "conecta.",
      notRunning: "Football Manager 27 no se está ejecutando.",
      openFailed: (error) => `No se ha podido abrir el juego: ${error}`,
      game: "Juego",
      gameData: "Datos del juego",
      loaded: "Cargados",
      stillLoading: "Aún cargando; espera al menú principal",
      process: "Proceso",
      pid: (pid) => `pid ${pid}`,
      several: "Hay varias copias del juego en ejecución; se usa la primera.",
      button: "Conectar y leer jugadores, personal y clubes",

      bridge: {
        title: "El puente (macOS)",
        intro:
          "macOS no deja que ninguna aplicación entre en la memoria de otra, así que es FM27 quien tiene que " +
          "entregar la suya. Lo hace en cuanto carga el puente de FMLibreEditor: una pequeña biblioteca que no " +
          "intercepta ni cambia nada en el juego y solo le da su memoria a esta aplicación. Una opción de " +
          "lanzamiento en Steam hace que FM27 la cargue.",
        library: "Puente",
        installed: "Instalado",
        missing: "No instalado",
        launchOption: "Opción de lanzamiento",
        set: "Configurada en Steam",
        notSet: "Sin configurar",
        ready:
          "Listo. Inicia FM27 desde Steam (ciérralo y vuelve a iniciarlo si está abierto), carga una partida y " +
          "conecta.",
        steamRunning:
          "Steam está abierto y, mientras lo está, conserva las opciones de lanzamiento. Cierra Steam para que la " +
          "opción de lanzamiento se configure por ti, o introdúcela tú en Steam.",
        setUp: "Instalar el puente",
        remove: "Quitar el puente",
        manual:
          "O, en Steam, haz clic derecho en Football Manager 27 › Propiedades › General › Opciones de lanzamiento, " +
          "e introduce:",
        copy: "Copiar",
        copied: "Copiado",
      },
    },
  },

  graphics: {
    reading: "Leyendo los paquetes gráficos…",
    summary: ({ clubLogos, flags, faces }) =>
      `Gráficos: ${format(clubLogos)} ${clubLogos === 1 ? "escudo" : "escudos"} · ` +
      `${format(flags)} ${flags === 1 ? "bandera" : "banderas"} · ${format(faces)} ${faces === 1 ? "cara" : "caras"}`,
    none: "No se han encontrado paquetes gráficos",
    noneHint: "Los paquetes de escudos y caras van en la carpeta de gráficos de FM27.",
  },

  compatibility: {
    unknownBuild: (game) => `FMLibreEditor aún no se ha probado con ${game}`,
    unknownBuildText:
      "Probablemente el juego se ha actualizado. FMLibreEditor ha encontrado los datos del juego y los ha comprobado, " +
      "pero no escribe en una versión con la que no se ha probado hasta que tú lo permitas. Una nueva versión de " +
      "FMLibreEditor que la conozca suele salir en pocos días.",
    allowedText:
      "La edición está activada en esta sesión, en la medida en que lo permiten las comprobaciones. Guarda una copia " +
      "de tu partida.",
    failedTitle: "Algunos datos del juego no han superado las comprobaciones",
    reloadHint: "Si una partida aún se estaba cargando, «Recargar datos» vuelve a comprobarlo.",
    noDate: "La fecha del juego no ha superado las comprobaciones, así que no se muestran las edades.",
    failed: (names) => `Quedan en solo lectura: ${names}.`,
    join: (names) =>
      names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`,
    allow: "Editar de todos modos",
    allowTitle:
      "Activa la edición hasta que se cierre FMLibreEditor o se vuelva a conectar. Haz antes una copia de tu partida.",
  },

  checks: {
    gameDate: "la fecha del juego",
    players: "los datos de los jugadores",
    positions: "las posiciones",
    attributes: "los atributos",
    personality: "la personalidad",
    liveValues: "la energía, el ritmo de competición, el cansancio y la moral",
    contracts: "los contratos",
    teams: "los equipos",
    staff: "el personal",
    clubs: "los clubes",
  },

  update: {
    available: (version) => `FMLibreEditor ${version} ya está disponible`,
    youHave: (version) => `Tienes la versión ${version}.`,
    download: "Descargar",
    install: "Actualizar",
    installTitle: "Descargar e instalar la nueva versión; FMLibreEditor se cierra y vuelve a abrirse con ella",
    preparing: "Preparando…",
    downloading: (percent) => (percent === null ? "Descargando…" : `Descargando… ${percent} %`),
    installing: "Instalando: FMLibreEditor se cerrará y volverá a abrirse con la nueva versión.",
    installFailed: (reason) => `No se ha podido actualizar: ${reason}. Descárgala desde su página.`,
    notInstallable: "Esta versión no se puede instalar desde aquí. Descárgala desde su página.",
    later: "Más tarde",
    check: "Buscar actualizaciones",
    checking: "Buscando actualizaciones…",
    upToDate: "Tienes la última versión.",
    failed: "No se ha podido comprobar si hay actualizaciones.",
  },

  edit: {
    unknownNation: "País desconocido",
    edit: "Editar",
    editTitle: "Cambiar los valores de este perfil en el juego",
    startFailed: (reason) => `No se ha podido empezar a editar: ${reason}`,
    positionRating: (position) => `Valoración de ${position}`,
    was: (value) => `antes: ${value}`,
    invalid: (min, max) => `Introduce un número entero de ${min} a ${max}`,
    invalidDate: (from, to) => `Introduce una fecha del ${from} al ${to}`,
    invalidMoney: (from, to) => `Introduce un importe entero de ${from} a ${to}`,
    invalidPercentage: (from, to) => `Introduce un porcentaje entero de ${from} a ${to}`,
    percent: "%",
    yes: "Sí",
    no: "No",
    none: "ninguno",

    // El pie
    footer: "Editando",
    changes: changeCount,
    invalidCount: (count) => (count === 1 ? "1 no válido" : `${count} no válidos`),
    review: "Revisar",
    reviewList: "Cambios por aplicar",
    discard: "Descartar",
    apply: "Aplicar",
    applying: "Aplicando…",
    applyBlocked: "Corrige antes los valores no válidos",
    done: "Hecho",
    confirmDiscard: (count) => `¿Descartar ${changes(count)}?`,
    keepEditing: "Seguir editando",

    // Tras aplicar
    applied: (count) =>
      count === 0
        ? "No se ha aplicado ningún cambio"
        : count === 1
          ? "1 cambio aplicado"
          : `${format(count)} cambios aplicados`,
    nothingToChange: "Nada que cambiar: el juego ya tiene estos valores.",
    refused: (label, reason) => `${label}: ${reason}`,
    rereadFailed: (reason) => `No se han podido volver a leer los valores: ${reason}`,
    dismiss: "Cerrar",
  },

  changes: {
    nav: "Cambios",
    title: "Cambios de esta sesión",
    hint:
      "Los más recientes primero. Un cambio solo se puede deshacer mientras el juego conserve el valor que escribió.",
    continueHint: "El juego muestra un cambio cuando avanza: pulsa Continuar en el juego.",
    swappedWith: (name) => `Intercambiado por ${name}`,
    fee: (amount) => `Traspaso: ${amount}`,
    healed: (count) => (count === 1 ? "1 lesión curada" : `${format(count)} lesiones curadas`),
    lifted: (count) => (count === 1 ? "1 sanción levantada" : `${format(count)} sanciones levantadas`),
    keptPlaying: (date) => (date === null ? "Seguirá jugando" : `Retirada del ${date} evitada`),
    count: (total, undone) => {
      const count = changeCount(total);
      if (undone === 0) {
        return count;
      }
      return `${count} · ${undone === 1 ? "1 deshecho" : `${format(undone)} deshechos`}`;
    },
    empty:
      "Aún no hay cambios. Abre un jugador, un miembro del personal o un club y elige Editar, o usa Edición " +
      "masiva en una lista.",
    columns: {
      time: "Hora",
      name: "Nombre",
      field: "Campo",
      change: "Cambio",
      status: "Estado",
    },
    kinds: { player: "Jugador", staff: "Personal", club: "Club" },
    stored: (change) => `valor interno ${change}`,
    undone: (time) => `Deshecho a las ${time}`,
    undo: "Deshacer",
    undoTitle: (label) => `Volver a escribir en el juego el valor anterior de ${label}`,
    batch: "Edición masiva",
    batchCount: (total, remaining) =>
      remaining === 0 ? `${changes(total)} · todos deshechos` : `${changes(total)} · ${format(remaining)} sin deshacer`,
    showChanges: "Mostrar cambios",
    hideChanges: "Ocultar cambios",
    undoBatch: "Deshacer edición masiva",
    undoBatchTitle: (remaining) =>
      "Volver a escribir en el juego los valores anteriores de esta edición masiva " +
      (remaining === 1 ? "(1 aún vigente)" : `(${format(remaining)} aún vigentes)`),

    // Páginas
    pages: "Páginas de la lista",
    batchPages: "Páginas de los cambios de esta edición masiva",
    previous: "Anterior",
    next: "Siguiente",
    range: (first, last, total) => `${format(first)}–${format(last)} de ${format(total)}`,
  },

  export: {
    button: "Exportar",
    buttonTitle:
      "Escribir los jugadores que muestra la lista en un archivo CSV o JSON, para una hoja de cálculo o un script",
    title: "Exportar jugadores",
    scope: (count) =>
      count === 0
        ? "Ningún jugador coincide con la búsqueda y los filtros."
        : `${count === 1 ? "1 jugador" : `${format(count)} jugadores`}: lo que seleccionan la búsqueda y los ` +
          "filtros de la lista, en su orden.",
    formatLabel: "Formato",
    formats: {
      csv: "CSV, separado por comas",
      csvSemicolon: "CSV, separado por punto y coma",
      json: "JSON",
    },
    formatHints: {
      csv: "Para la mayoría de hojas de cálculo y scripts",
      csvSemicolon: "Para Excel donde los decimales se escriben con coma: en español, turco o alemán, por ejemplo",
      json: "Para scripts: las posiciones, los atributos y la personalidad como objetos propios",
    },
    contents:
      "De cada jugador: habilidades, posiciones y valoraciones por posición, atributos en la escala de 1 a 20 " +
      "(también los ocultos), personalidad, reputación, partidos internacionales, y contrato con sus cláusulas, con " +
      "la fecha del juego. El dinero va en libras, como lo guarda el juego. No cambia nada en el juego.",
    export: "Exportar",
    exporting: "Exportando…",
    done: (count, file) =>
      `${count === 1 ? "1 jugador exportado" : `${format(count)} jugadores exportados`} a ${file}`,
    folder: (folder) => `en ${folder}`,
    skipped: (count) =>
      `${count === 1 ? "1 jugador cambió" : `${format(count)} jugadores cambiaron`} en el juego mientras se ` +
      "leían, y se dejaron fuera.",
    open: "Abrir",
    openTitle: "Abrir el archivo con la aplicación que tu sistema usa para él",
    show: "Mostrar en la carpeta",
    showTitle: "Mostrar el archivo en su carpeta",
    close: "Cerrar",
  },

  massEdit: {
    button: "Edición masiva",
    buttonTitle: "Cambiar valores de todo lo que muestra la lista, con una vista previa antes",
    title: {
      player: "Edición masiva de jugadores",
      staff: "Edición masiva de personal",
      club: "Edición masiva de clubes",
    },

    // A qué se aplica
    scope: (entity, total) =>
      total === 1
        ? `El ${nouns[entity].one} que muestra ahora la lista (búsqueda y filtros)`
        : `Los ${entityCount(entity, total)} que muestra ahora la lista (búsqueda y filtros)`,
    scopeAll: (shown) => `Son todas las coincidencias, no solo las ${format(shown)} primeras filas en pantalla.`,
    scopeNone: (entity) =>
      `Ningún ${nouns[entity].one} coincide con la búsqueda y los filtros, así que no hay nada que cambiar.`,
    scopeTooMany: (entity, total, limit) =>
      `Los ${entityCount(entity, total)} que muestra la lista son más de los que admite una edición masiva ` +
      `(${format(limit)}). Acota antes la búsqueda o los filtros.`,
    loadingFields: "Leyendo los campos…",
    fieldsFailed: (reason) => `No se han podido leer los campos: ${reason}`,

    // Los campos que cambiar
    groups: {
      ability: "Habilidad",
      technical: "Atributos técnicos",
      mental: "Atributos mentales",
      physical: "Atributos físicos",
      goalkeeping: "Atributos de portero",
      hidden: "Atributos ocultos",
      feet: "Pies",
      coaching: "Atributos de entrenamiento",
      knowledge: "Atributos de conocimiento",
      medical: "Atributos médicos",
      positions: "Posiciones",
      personality: "Personalidad",
      reputation: "Reputación",
      international: "Internacional",
      contract: "Contrato",
      facilities: "Instalaciones",
      finances: "Finanzas",
      stadium: "Estadio",
      traits: "Características",
      health: "Médico",
      other: "Otros",
    },
    fieldsLabel: "Campos que cambiar",
    row: (position) => `Cambio ${position}`,
    field: "Campo",
    operation: "Operación",
    operations: { set: "Fijar en", add: "Sumar", scale: "Escalar al %" },
    values: { set: "Valor", add: "Cantidad", scale: "Porcentaje" },
    addTitle: "Se suma a cada valor tal como se muestra; un número negativo resta",
    addPointsTitle: "Puntos porcentuales sumados a cada valor (70 % más 10 es 80 %); un número negativo resta",
    rangeHint: (min, max) => `${format(min)}–${format(max)}`,
    amountHint: (max) => `±${format(max)}`,
    ofCurrent: "% del valor actual",
    percentTitle:
      "Un porcentaje del valor actual: 100 lo mantiene, 110 lo sube una décima parte, 50 lo reduce a la mitad",
    invalidAdd: (min, max) => `Introduce un número entero de ${format(min)} a ${format(max)}`,
    invalidPercent: (min, max) => `Introduce un porcentaje entero de ${min} a ${max}`,
    dateSetOnly: "Una fecha solo se puede fijar",
    addField: "Añadir un campo",
    addFieldFull: (max) => `Una edición masiva cambia hasta ${max} campos`,
    remove: "Quitar este campo",
    removeLast: "Una edición masiva necesita al menos un campo",

    // La vista previa
    preview: "Vista previa",
    previewing: "Generando la vista previa…",
    previewBlocked: "Rellena cada campo con un valor válido para ver la vista previa",
    summary: (entity, preview) =>
      [
        preview.changes === 0
          ? "Ningún cambio"
          : `${changes(preview.changes)} en ${format(preview.targets - preview.unchanged)} de ` +
            entityCount(entity, preview.targets),
        preview.unchanged > 0 &&
          (preview.unchanged === 1
            ? "1 ya tiene estos valores"
            : `${format(preview.unchanged)} ya tienen estos valores`),
        preview.skippedCount > 0 && valuesLeftAlone(preview.skippedCount),
      ]
        .filter(Boolean)
        .join(" · "),
    tableLabel: "Cambios que haría la edición masiva",
    columns: { name: "Nombre", field: "Campo", change: "Cambio", reason: "Motivo" },
    more: (count) => `y ${format(count)} más`,
    skippedHeading: valuesLeftAlone,
    skippedLabel: "Valores que la edición masiva deja sin tocar",

    // Aplicar y deshacer
    apply: "Aplicar",
    applying: "Aplicando…",
    applyTitle: (count) => `Escribir ${changes(count)} en el juego`,
    applyFirst: "Genera antes la vista previa de la edición masiva",
    applyNothing: "La vista previa no tiene cambios que escribir",
    hint: "Nada cambia en el juego hasta que aplicas.",
    applied: (count) =>
      count === 0
        ? "No se ha escrito ningún cambio"
        : count === 1
          ? "1 cambio aplicado"
          : `${format(count)} cambios aplicados`,
    failure: (name, label, reason) => `${name} · ${label}: ${reason}`,
    undo: "Deshacer esta edición masiva",
    undoing: "Deshaciendo…",
    undoTitle: "Volver a escribir en el juego los valores anteriores de esta edición masiva",
    undone: (count) =>
      count === 0
        ? "No se ha deshecho nada"
        : count === 1
          ? "1 cambio deshecho"
          : `${format(count)} cambios deshechos`,
    undoFailure: (who, reason) => `${who}: ${reason}`,
    changeNumber: (id) => `Cambio ${id}`,
    close: "Cerrar",
  },

  comparison: {
    compare: "Comparar",
    add: "Añadir a la comparación",
    remove: "Quitar de la comparación",
    full: (max) => `Una comparación admite hasta ${max} jugadores. Quita uno para añadir a este jugador.`,

    // La bandeja bajo la lista de jugadores
    trayLabel: "Jugadores que comparar",
    removePlayer: (name) => `Quitar de la comparación: ${name}`,
    clear: "Vaciar",
    open: (count) => `Comparar (${count})`,

    // El diálogo
    title: "Comparación",
    hint: "Se resalta el mejor valor de cada fila: el más alto o, donde más bajo es mejor, el más bajo.",
    tooFew: "Añade al menos dos jugadores para compararlos.",
    loading: "Cargando los jugadores…",
    tableLabel: "Valores de los jugadores comparados",
    highest: "el más alto",
    lowest: "el más bajo",
    profile: "Perfil",
    close: "Cerrar",
  },

  move: {
    button: "Traspasar",
    buttonTitle: "Traspasar a este jugador a otro club en el juego, por un precio si quieres",

    // El diálogo
    title: "Traspaso",
    from: "Origen",
    to: "Destino",

    modeLabel: "Traspaso o intercambio",
    modeMove: "Traspasar a un club",
    modeSwap: "Intercambiar por un jugador",

    // El club
    searchLabel: "Buscar el club al que traspasar",
    resultsLabel: "Clubes encontrados",
    searching: "Buscando clubes…",
    searchFailed: (reason) => `No se han podido buscar los clubes: ${reason}`,
    more: (count) => `y ${format(count)} más; escribe para acotar la búsqueda`,
    change: "Elegir otro club",

    // El precio
    feeHeading: "Precio",
    fee: "Precio del traspaso",
    feeHint: "Déjalo vacío para un traspaso gratuito",
    feeInvalid: (max) => `Introduce un importe entero, de 0 a ${max}`,
    pays: (club, fee, balance, budget) =>
      `${club} paga ${fee}: saldo ${balance}${budget === null ? "" : `, presupuesto de fichajes ${budget}`}`,
    receives: (club, fee, balance) => `${club} recibe ${fee}: saldo ${balance}`,
    noFinances: (club) => `${club} no tiene finanzas en el juego: su dinero no cambia`,

    // El contrato
    wageInvalid: "Introduce un importe entero, 0 o más",
    expiresInvalid: "Introduce una fecha",

    // El traspaso
    chooseClub: "Elige el club al que traspasar al jugador.",
    fixTerms: "Corrige antes el precio o los valores del contrato.",
    checking: "Comprobando el traspaso…",
    route: (from, to) => `${from} → ${to}`,
    doesHeading: "Qué hace el traspaso",
    does: [
      "Se une al primer equipo del nuevo club",
      "Contrato con fecha del día del juego; se le quita el dorsal",
      "Sale de las listas de transferibles y cedibles",
      "El salario y el fin de contrato solo cambian si fijas otros nuevos",
      "El precio sale del saldo y del presupuesto de fichajes del comprador, y entra en el saldo del vendedor",
      "Cualquier capitanía en el club anterior queda vacante",
      "El historial de traspasos del juego aún no lo recoge",
      "Aparece en Cambios, donde deshacerlo revierte de una vez el traspaso y el precio",
    ],

    // El intercambio
    swapTitle: "Intercambiar por un jugador",
    swapWith: "Intercambiar por",
    playerSearchLabel: "Buscar el jugador por el que intercambiar",
    playerSearch: "Buscar jugadores de este club por nombre",
    playersLabel: "Jugadores encontrados",
    playersSearching: "Buscando jugadores…",
    playersSearchFailed: (reason) => `No se han podido buscar los jugadores: ${reason}`,
    playersEmpty: (query) =>
      query === "" ? "Este club no tiene jugadores." : `Ningún jugador de este club coincide con «${query}».`,
    changePlayer: "Elegir otro jugador",

    swapContract: "Cada jugador conserva su contrato; los salarios y los fines de contrato no cambian.",
    // Mover a un miembro del personal
    staffButtonTitle: "Mover a este miembro del personal a otro club en el juego",
    staffChooseClub: "Elige el club al que mover a este miembro del personal.",
    staffContract: "Conserva el puesto, el salario y el fin de contrato; el contrato lleva la fecha del día del juego.",
    staffDoes: [
      "Se une al nuevo club en los departamentos en los que trabaja (médico, técnico, ojeo)",
      "Mismo puesto, salario y fin de contrato; el contrato lleva la fecha del día del juego",
      "Del mánager de un equipo, al que apunta el propio equipo, se encarga el juego",
      "Aparece en Cambios, donde se puede deshacer",
    ],
    swapChooseClub: "Elige el club del jugador por el que intercambiar.",
    swapChoosePlayer: "Elige el jugador por el que intercambiar.",
    swapChecking: "Comprobando el intercambio…",
    swapRoute: (player, from, to, other) => `${player}: ${from} → ${to}\n${other}: ${to} → ${from}`,
    swapDoesHeading: "Qué hace el intercambio",
    swapDoes: [
      "Cada uno se une al primer equipo del club del otro",
      "Contratos con fecha del día del juego; se les quitan los dorsales",
      "Ambos salen de las listas de transferibles y cedibles",
      "Cualquier capitanía en sus clubes anteriores queda vacante",
      "No se paga ningún precio; la trayectoria no se actualiza",
      "Aparece en Cambios como un solo cambio, que deshace los dos movimientos",
    ],

    // El pie
    hint: "Nada cambia en el juego hasta que pulsas Traspasar.",
    move: "Traspasar",
    moving: "Traspasando…",
    cancel: "Cancelar",
    swapHint: "Nada cambia en el juego hasta que pulsas Intercambiar.",
    swap: "Intercambiar",
    swapping: "Intercambiando…",
  },

  ties: {
    heading: "Nacionalidad y formación local",
    nationalities: "Nacionalidades secundarias",
    trainedInNation: "Formado en el país",
    trainedAtClub: "Formado en el club",
    none: "Ninguna",
    rules: {
      1: "Formado localmente 15-21",
      2: "Formado localmente 0-21",
      5: "Formado localmente 15-21 (sin cesiones)",
      10: "Formado localmente 0-19 (1 año)",
    },
    rule: (code) => `Regla de formación local ${format(code)}`,

    // El botón y su diálogo
    change: "Cambiar",
    changeTitle: "Cambiar las nacionalidades secundarias y la formación local de este jugador en el juego",
    title: "Nacionalidad y formación local",
    hint: "Cada cambio se escribe en el juego al momento y aparece en Cambios, donde se puede deshacer.",
    full:
      "El juego hizo la lista de este jugador justo del tamaño de lo que contiene: se puede cambiar o quitar una " +
      "nacionalidad o una formación, pero no añadir.",
    nationOf: (name) => `País en lugar de ${name}`,
    ruleOf: (name) => `Regla de formación local para ${name}`,
    remove: "Quitar",
    removeTitle: (name) => `Quitar ${name}`,
    addNationality: "Añadir una nacionalidad…",
    addNation: "Añadir un país…",
    newRule: "Regla de formación local del nuevo país",
    add: "Añadir",
    clubNote: "A un club se le puede dar otra regla o quitarlo; los clubes los añade el propio juego.",
    working: "Escribiendo en el juego…",
    close: "Cerrar",
  },

  clauses: {
    change: "Cambiar",
    changeTitle: "Cambia en el juego las primas y cláusulas de este jugador",
    title: "Primas y cláusulas",
    hint: "Cada cambio se escribe en el juego al momento y aparece en Cambios, donde se puede deshacer.",
    full:
      "El juego hizo la lista de este contrato justo del tamaño de lo que contiene: se puede cambiar o quitar una " +
      "prima o cláusula, pero no añadir una cláusula de rescisión.",
    amountOf: (name) => `Importe de ${name}`,
    conditionOf: (name) => `Condición de ${name}`,
    save: "Guardar",
    remove: "Quitar",
    removeTitle: (name) => `Quitar ${name}`,
    addRelease: "Añadir una cláusula de rescisión",
    releaseAmount: "Importe de la nueva cláusula de rescisión",
    add: "Añadir",
    outOfRange: (max) => `Escribe un número entero de 0 a ${max}.`,
    working: "Escribiendo en el juego…",
    close: "Cerrar",
  },

  release: {
    button: "Rescindir",
    buttonTitle: "Rescindir el contrato de este jugador con su club en el juego: pasa a ser agente libre",

    // El diálogo
    title: "Rescisión",
    from: "Sale de",
    checking: "Comprobando la rescisión…",
    ready: (club) => `${club} → agente libre`,
    doesHeading: "Qué hace la rescisión",
    does: [
      "Sale de todos los equipos del club y su contrato termina: es agente libre y cualquier club puede ficharlo",
      "Nadie cobra nada",
      "Cualquier capitanía en el club queda vacante",
      "El historial de traspasos del juego no lo recoge",
      "Aparece en Cambios, donde deshacerla devuelve al jugador con el mismo contrato",
    ],

    // El pie
    hint: "Nada cambia en el juego hasta que pulsas Rescindir.",
    release: "Rescindir",
    releasing: "Rescindiendo…",
    cancel: "Cancelar",
  },

  squad: {
    teamsLabel: "Equipo",
    teams: {
      first: "Primer equipo",
      b: "Equipo B",
      age: (limit) => `Sub-${limit}`,
      other: (place) => `Equipo ${place}`,
    },
    noTeams: "Este club no tiene equipos.",
    loading: "Leyendo la plantilla…",
    empty: "No hay jugadores en este equipo.",

    // Sobre la tabla
    players: (count) => entityCount("player", count),
    averageAge: (age) => `edad media ${age}`,
    captains: (captain, viceCaptain) => `Capitán: ${captain} · Vicecapitán: ${viceCaptain}`,

    // Las acciones sobre todo el equipo
    actionsLabel: "Acciones sobre todo el equipo",
    healAll: (injured) =>
      injured === 0
        ? "Curar a todos"
        : `Curar a todos (${injured === 1 ? "1 lesionado" : `${format(injured)} lesionados`})`,
    healAllTitle: "Curar todas las lesiones de todos los jugadores de este equipo",
    healNone: "Nadie en este equipo está lesionado",
    liftAll: (banned) =>
      banned === 0
        ? "Levantar sanciones"
        : `Levantar sanciones (${banned === 1 ? "1 sancionado" : `${format(banned)} sancionados`})`,
    liftAllTitle: "Levantar todas las sanciones de todos los jugadores de este equipo",
    liftNone: "Nadie en este equipo está sancionado",
    inspireAll: "Motivar a todos",
    inspireAllTitle: "Poner la moral de todos los jugadores de este equipo en 20, la más alta",
    refreshAll: "Recuperar a todos",
    refreshAllTitle:
      "Poner la energía y el ritmo de competición de todos los jugadores de este equipo al 100 % y dejarlos " +
      "totalmente descansados (fatiga -500)",
    maxAll: "Atributos al máximo",
    maxAllTitle:
      "Poner cada atributo de cada jugador de este equipo en su mejor valor: 20, y 1 para la propensión a lesiones y " +
      "el juego sucio",
    hint:
      "Las acciones abarcan a todos los jugadores de la lista, también a los cedidos. Se pueden deshacer también " +
      "en Cambios.",

    // Lo que hizo una acción
    written: (count) =>
      count === 0
        ? "No se ha escrito ningún cambio"
        : count === 1
          ? "1 cambio escrito"
          : `${format(count)} cambios escritos`,
    refused: (name, reason) => `${name}: ${reason}`,
    undo: "Deshacer",
    undoTitle: "Volver a escribir en el juego los valores anteriores de estos cambios",

    // Capitanes
    captainShort: "C",
    viceCaptainShort: "VC",
    menuLabel: (name) => `Capitanía de ${name}`,
    menuTitle: "Capitanía",
    makeCaptain: "Nombrar capitán",
    makeViceCaptain: "Nombrar vicecapitán",
    nowCaptain: (name) => `${name} es ahora el capitán`,
    nowViceCaptain: (name) => `${name} es ahora el vicecapitán`,
    noCaptain: "Ahora nadie es capitán",
    noViceCaptain: "Ahora nadie es vicecapitán",

    // La tabla
    tableLabel: (team) => `Jugadores del equipo: ${team}`,
    columns: {
      name: "Nombre",
      position: "Pos.",
      age: "Edad",
      currentAbility: "HA",
      potentialAbility: "HP",
      condition: "Energía",
      matchSharpness: "Ritmo",
      jadedness: "Fatiga",
      morale: "Moral",
      actions: "Capitanía",
    },
    sortBy: (by) => `Ordenar por ${by}`,
    sortNames: {
      name: "nombre",
      position: "posición",
      age: "edad",
      currentAbility: "habilidad actual",
      potentialAbility: "habilidad potencial",
      condition: "energía",
      matchSharpness: "ritmo de competición",
      jadedness: "fatiga",
      morale: "moral",
    },

    // Las etiquetas tras un nombre
    injured: "Lesionado",
    injuredTitle: (count) => (count === 1 ? "1 lesión" : `${format(count)} lesiones`),
    banned: "Sancionado",
    bannedTitle: (count) => (count === 1 ? "1 sanción" : `${format(count)} sanciones`),
    onLoan: "Cedido",
    onLoanTitle: "Cedido a otro club",
    loanee: "En préstamo",
    loaneeTitle: "Aquí cedido por otro club",
    elsewhere: "En otro equipo",
    elsewhereTitle: "Juega en otro equipo del club",
  },

  game: {
    name: "Football Manager",
    storefronts: {
      gamePass: "Game Pass",
      steam: "Steam",
      epic: "Epic Games",
      unknown: "Tienda desconocida",
    },
    steamBuild: (id) => `(compilación ${id})`,
  },

  errors,
};
