/**
 * Every sentence and label `<Shield>` puts in front of a reader, per language.
 *
 * ## Why one table and not more props
 *
 * An author could already translate the drawn notice through `wrapper={{ text,
 * labels }}`, and the docs said so. What that never reached was everything
 * else a reader meets: the toasts, the live-region announcements, the wait
 * estimate the browser computes ("about 10 seconds"), the clipboard notice, the
 * clipped tier's status lines. A French page got a French sentence and English
 * everywhere around it, and the English parts are the ones spoken by a screen
 * reader mid-task, which is the worst place for a language switch. There was no
 * prop for most of them, and adding one per string would have meant thirty.
 *
 * ## What the browser scripts get
 *
 * The emitted scripts stay byte-identical on every page: strings travel as
 * attributes written by React, the same arrangement the notice already used for
 * its `-says` JSON. An English block ships exactly the attributes it did before
 * this file existed, and the scripts fall back to their own English when a key
 * is absent. Only a non-English block carries the extra keys.
 *
 * ## Placeholders
 *
 * `{show}`, `{n}`, `{name}`, `{label}` and `{noun}` are filled by {@link fill}.
 * Word order is the template's business, not the caller's, so a language that
 * puts the number after the unit can.
 *
 * ## The translations
 *
 * `en` is the shipped wording, unchanged. The others were written to match its
 * register (plain verbs, the reader addressed directly, formal "you" where a
 * language has one) and want a native speaker's pass before anyone calls them
 * final. Two constraints are easy to break when editing one:
 *
 * - `showLong` must START WITH `show`. A speech-input user says the words they
 *   can see, so the spoken name has to begin with them. `resolveNotice` falls
 *   back to `show` when it does not, which is safe and loses the longer name.
 * - Keep every placeholder a string has in English. `locales.test.ts` checks
 *   both.
 */

export interface ShieldStrings {
  // The drawn notice. Same meanings as the matching `ShieldNotice` fields.
  short: string;
  text: string;
  repeat: string;
  broken: string;
  noScript: string;
  show: string;
  showLong: string;
  copy: string;
  restore: string;
  info: string;
  progress: string;
  /** Appended to the first Uncover button on a page. `{name}` is its name. */
  slow: string;
  /** Said once the original is on screen. Both tiers use the same sentence. */
  open: string;
  loading: string;
  keep: string;
  /** Follows the number in a progress announcement: "50 percent." */
  pct: string;
  copied: string;
  toastCopied: string;
  toastBlocked: string;
  copyFail: string;
  /** `{show}` is the visible Uncover label. */
  clipped: string;
  insecure: string;
  incapable: string;
  /** Clipboard text when the copy touched protected words inside a wrapper. */
  clipboard: string;
  /** The same, for a block with no wrapper drawn. See `standaloneClipboardNotice`. */
  clipboardAlone: string;

  // The wait estimate. Seconds are rounded to fives with a floor of 5, and
  // minutes start at 2, so no language here needs a singular for either.
  seconds: string;
  minute: string;
  minutes: string;

  /** A protected block's group name: `{label}`, `{noun}`, `{n}`. */
  group: string;
  nouns: {
    heading: string;
    paragraph: string;
    quote: string;
    listItem: string;
    caption: string;
    section: string;
  };

  // The clipped tier (no wrapper drawn), which has its own solver script.
  /** The clipped Uncover button's name. `{n}` is the ceiling in seconds. */
  puzzle: string;
  ready: string;
  doneShown: string;
  done: string;
  insecureShort: string;
  fail: string;
  tryAgain: string;
  working: string;
}

const en: ShieldStrings = {
  short: "Protected from AI bots.",
  text:
    "If you use a screen reader, custom font, or translator, please uncover the " +
    "text before reading.",
  repeat: "Scrambled text. Uncover the original below.",
  broken: "The text below isn’t showing correctly. Uncover the original to read it.",
  noScript:
    "Uncovering it needs JavaScript, which is turned off in this browser, so the " +
    "original words cannot be shown here. Turn JavaScript on for this site and reload.",
  show: "Uncover",
  showLong: "Uncover the original text",
  copy: "Copy to clipboard",
  restore: "Restore",
  info: "What does this mean?",
  progress: "Decoding progress",
  slow: "{name}, takes a few seconds",
  open: "You are now reading the original text.",
  loading: "Loading text…",
  keep: "You can keep reading.",
  pct: "percent.",
  copied: "The original is on your clipboard.",
  toastCopied: "Copied to clipboard",
  toastBlocked: "Copy blocked — uncover the text first",
  copyFail: "Copying didn’t work. Press Copy again.",
  clipped: "Copied a notice instead. Press “{show}” to get the real words.",
  insecure: "Showing the original needs a secure (https) connection.",
  incapable: "This browser can’t show the full text.",
  clipboard:
    "[This text is protected from AI bots and didn’t copy correctly. " +
    "Use “{show}” next to it, then copy again.]",
  clipboardAlone:
    "[This text is protected from AI bots, so what you copied is not what you " +
    "read on screen. A control that shows the original sits immediately before " +
    "this passage — reach it with the Tab key or your screen reader, show the " +
    "text, then copy again.]",
  seconds: "about {n} seconds",
  minute: "about a minute",
  minutes: "about {n} minutes",
  group: "{label}, {noun} {n}",
  nouns: {
    heading: "heading",
    paragraph: "paragraph",
    quote: "quote",
    listItem: "list item",
    caption: "caption",
    section: "section",
  },
  puzzle: "Uncover the original text (up to {n} seconds)",
  ready: "The text is ready.",
  doneShown: "Done. The text is shown below.",
  done: "Done.",
  insecureShort: "This needs a secure (https) connection.",
  fail: "Something went wrong.",
  tryAgain: "You can try again.",
  working: "Working. This will take a little while. You can keep reading the page.",
};

const fr: ShieldStrings = {
  short: "Protégé des robots d’IA.",
  text:
    "Si vous utilisez un lecteur d’écran, une police personnalisée ou un traducteur, " +
    "veuillez dévoiler le texte avant de le lire.",
  repeat: "Texte brouillé. Dévoilez l’original ci-dessous.",
  broken: "Le texte ci-dessous ne s’affiche pas correctement. Dévoilez l’original pour le lire.",
  noScript:
    "Pour le dévoiler, il faut JavaScript, qui est désactivé dans ce navigateur : le texte " +
    "original ne peut donc pas s’afficher ici. Activez JavaScript pour ce site et rechargez la page.",
  show: "Dévoiler",
  showLong: "Dévoiler le texte original",
  copy: "Copier dans le presse-papiers",
  restore: "Rétablir",
  info: "Qu’est-ce que cela signifie ?",
  progress: "Progression du décodage",
  slow: "{name}, prend quelques secondes",
  open: "Vous lisez maintenant le texte original.",
  loading: "Chargement du texte…",
  keep: "Vous pouvez continuer à lire.",
  pct: "pour cent.",
  copied: "L’original est dans votre presse-papiers.",
  toastCopied: "Copié dans le presse-papiers",
  toastBlocked: "Copie bloquée — dévoilez d’abord le texte",
  copyFail: "La copie n’a pas fonctionné. Appuyez à nouveau sur Copier.",
  clipped: "Un avis a été copié à la place. Appuyez sur « {show} » pour obtenir le vrai texte.",
  insecure: "Afficher l’original nécessite une connexion sécurisée (https).",
  incapable: "Ce navigateur ne peut pas afficher le texte complet.",
  clipboard:
    "[Ce texte est protégé des robots d’IA et n’a pas été copié correctement. " +
    "Utilisez « {show} » juste à côté, puis copiez à nouveau.]",
  clipboardAlone:
    "[Ce texte est protégé des robots d’IA : ce que vous avez copié n’est pas ce que " +
    "vous lisez à l’écran. Une commande qui affiche l’original se trouve juste avant ce " +
    "passage — atteignez-la avec la touche Tab ou votre lecteur d’écran, affichez le texte, " +
    "puis copiez à nouveau.]",
  seconds: "environ {n} secondes",
  minute: "environ une minute",
  minutes: "environ {n} minutes",
  group: "{label}, {noun} {n}",
  nouns: {
    heading: "titre",
    paragraph: "paragraphe",
    quote: "citation",
    listItem: "élément de liste",
    caption: "légende",
    section: "section",
  },
  puzzle: "Dévoiler le texte original (jusqu’à {n} secondes)",
  ready: "Le texte est prêt.",
  doneShown: "Terminé. Le texte s’affiche ci-dessous.",
  done: "Terminé.",
  insecureShort: "Cela nécessite une connexion sécurisée (https).",
  fail: "Un problème est survenu.",
  tryAgain: "Vous pouvez réessayer.",
  working: "En cours. Cela va prendre un peu de temps. Vous pouvez continuer à lire la page.",
};

const es: ShieldStrings = {
  short: "Protegido de los bots de IA.",
  text:
    "Si usa un lector de pantalla, una fuente personalizada o un traductor, revele el " +
    "texto antes de leerlo.",
  repeat: "Texto alterado. Revele el original más abajo.",
  broken: "El texto de abajo no se muestra correctamente. Revele el original para leerlo.",
  noScript:
    "Para revelarlo se necesita JavaScript, que está desactivado en este navegador, así que " +
    "el texto original no se puede mostrar aquí. Active JavaScript para este sitio y vuelva " +
    "a cargar la página.",
  show: "Revelar",
  showLong: "Revelar el texto original",
  copy: "Copiar al portapapeles",
  restore: "Restaurar",
  info: "¿Qué significa esto?",
  progress: "Progreso de la decodificación",
  slow: "{name}, tarda unos segundos",
  open: "Ahora está leyendo el texto original.",
  loading: "Cargando el texto…",
  keep: "Puede seguir leyendo.",
  pct: "por ciento.",
  copied: "El original está en su portapapeles.",
  toastCopied: "Copiado al portapapeles",
  toastBlocked: "Copia bloqueada: revele primero el texto",
  copyFail: "No se pudo copiar. Pulse Copiar de nuevo.",
  clipped: "Se copió un aviso en su lugar. Pulse «{show}» para obtener el texto real.",
  insecure: "Para mostrar el original se necesita una conexión segura (https).",
  incapable: "Este navegador no puede mostrar el texto completo.",
  clipboard:
    "[Este texto está protegido de los bots de IA y no se copió correctamente. " +
    "Use «{show}» junto a él y vuelva a copiar.]",
  clipboardAlone:
    "[Este texto está protegido de los bots de IA, así que lo que copió no es lo que lee " +
    "en pantalla. Justo antes de este pasaje hay un control que muestra el original: llegue " +
    "a él con la tecla Tab o con su lector de pantalla, muestre el texto y vuelva a copiar.]",
  seconds: "unos {n} segundos",
  minute: "alrededor de un minuto",
  minutes: "unos {n} minutos",
  group: "{label}, {noun} {n}",
  nouns: {
    heading: "encabezado",
    paragraph: "párrafo",
    quote: "cita",
    listItem: "elemento de lista",
    caption: "pie de figura",
    section: "sección",
  },
  puzzle: "Revelar el texto original (hasta {n} segundos)",
  ready: "El texto está listo.",
  doneShown: "Listo. El texto se muestra abajo.",
  done: "Listo.",
  insecureShort: "Esto necesita una conexión segura (https).",
  fail: "Algo salió mal.",
  tryAgain: "Puede volver a intentarlo.",
  working: "Procesando. Tardará un poco. Puede seguir leyendo la página.",
};

const pt: ShieldStrings = {
  short: "Protegido contra robôs de IA.",
  text:
    "Se você usa leitor de tela, fonte personalizada ou tradutor, revele o texto antes " +
    "de ler.",
  repeat: "Texto embaralhado. Revele o original abaixo.",
  broken: "O texto abaixo não está aparecendo corretamente. Revele o original para ler.",
  noScript:
    "Para revelar é preciso JavaScript, que está desativado neste navegador, então o texto " +
    "original não pode ser mostrado aqui. Ative o JavaScript para este site e recarregue a página.",
  show: "Revelar",
  showLong: "Revelar o texto original",
  copy: "Copiar para a área de transferência",
  restore: "Restaurar",
  info: "O que isso significa?",
  progress: "Progresso da decodificação",
  slow: "{name}, leva alguns segundos",
  open: "Agora você está lendo o texto original.",
  loading: "Carregando o texto…",
  keep: "Você pode continuar lendo.",
  pct: "por cento.",
  copied: "O original está na sua área de transferência.",
  toastCopied: "Copiado para a área de transferência",
  toastBlocked: "Cópia bloqueada — revele o texto primeiro",
  copyFail: "A cópia não funcionou. Toque em Copiar de novo.",
  clipped: "Um aviso foi copiado no lugar. Toque em “{show}” para obter o texto real.",
  insecure: "Mostrar o original exige uma conexão segura (https).",
  incapable: "Este navegador não consegue mostrar o texto completo.",
  clipboard:
    "[Este texto está protegido contra robôs de IA e não foi copiado corretamente. " +
    "Use “{show}” ao lado dele e copie de novo.]",
  clipboardAlone:
    "[Este texto está protegido contra robôs de IA, então o que você copiou não é o que você " +
    "lê na tela. Um controle que mostra o original fica logo antes deste trecho — chegue até " +
    "ele com a tecla Tab ou com o seu leitor de tela, mostre o texto e copie de novo.]",
  seconds: "cerca de {n} segundos",
  minute: "cerca de um minuto",
  minutes: "cerca de {n} minutos",
  group: "{label}, {noun} {n}",
  nouns: {
    heading: "título",
    paragraph: "parágrafo",
    quote: "citação",
    listItem: "item de lista",
    caption: "legenda",
    section: "seção",
  },
  puzzle: "Revelar o texto original (até {n} segundos)",
  ready: "O texto está pronto.",
  doneShown: "Pronto. O texto aparece abaixo.",
  done: "Pronto.",
  insecureShort: "Isso exige uma conexão segura (https).",
  fail: "Algo deu errado.",
  tryAgain: "Você pode tentar de novo.",
  working: "Processando. Isso vai levar um tempinho. Você pode continuar lendo a página.",
};

const de: ShieldStrings = {
  short: "Vor KI-Bots geschützt.",
  text:
    "Wenn Sie einen Screenreader, eine eigene Schriftart oder einen Übersetzer nutzen, " +
    "decken Sie den Text bitte vor dem Lesen auf.",
  repeat: "Verfremdeter Text. Decken Sie unten das Original auf.",
  broken: "Der Text unten wird nicht richtig angezeigt. Decken Sie das Original auf, um ihn zu lesen.",
  noScript:
    "Zum Aufdecken wird JavaScript benötigt, das in diesem Browser ausgeschaltet ist. Der " +
    "Originaltext kann hier daher nicht angezeigt werden. Schalten Sie JavaScript für diese " +
    "Seite ein und laden Sie sie neu.",
  show: "Aufdecken",
  showLong: "Aufdecken und Originaltext lesen",
  copy: "In die Zwischenablage kopieren",
  restore: "Wiederherstellen",
  info: "Was bedeutet das?",
  progress: "Fortschritt der Entschlüsselung",
  slow: "{name}, dauert ein paar Sekunden",
  open: "Sie lesen jetzt den Originaltext.",
  loading: "Text wird geladen…",
  keep: "Sie können weiterlesen.",
  pct: "Prozent.",
  copied: "Das Original ist in Ihrer Zwischenablage.",
  toastCopied: "In die Zwischenablage kopiert",
  toastBlocked: "Kopieren blockiert – decken Sie zuerst den Text auf",
  copyFail: "Kopieren hat nicht funktioniert. Drücken Sie erneut auf Kopieren.",
  clipped: "Stattdessen wurde ein Hinweis kopiert. Drücken Sie „{show}“, um den echten Text zu erhalten.",
  insecure: "Zum Anzeigen des Originals ist eine sichere (https-)Verbindung nötig.",
  incapable: "Dieser Browser kann den vollständigen Text nicht anzeigen.",
  clipboard:
    "[Dieser Text ist vor KI-Bots geschützt und wurde nicht richtig kopiert. " +
    "Nutzen Sie „{show}“ daneben und kopieren Sie dann erneut.]",
  clipboardAlone:
    "[Dieser Text ist vor KI-Bots geschützt, daher ist das Kopierte nicht das, was Sie auf " +
    "dem Bildschirm lesen. Direkt vor diesem Abschnitt steht ein Bedienelement, das das " +
    "Original anzeigt – erreichen Sie es mit der Tabulatortaste oder Ihrem Screenreader, " +
    "zeigen Sie den Text an und kopieren Sie dann erneut.]",
  seconds: "etwa {n} Sekunden",
  minute: "etwa eine Minute",
  minutes: "etwa {n} Minuten",
  group: "{label}, {noun} {n}",
  nouns: {
    heading: "Überschrift",
    paragraph: "Absatz",
    quote: "Zitat",
    listItem: "Listeneintrag",
    caption: "Bildunterschrift",
    section: "Abschnitt",
  },
  puzzle: "Aufdecken und Originaltext lesen (bis zu {n} Sekunden)",
  ready: "Der Text ist bereit.",
  doneShown: "Fertig. Der Text steht unten.",
  done: "Fertig.",
  insecureShort: "Dafür ist eine sichere (https-)Verbindung nötig.",
  fail: "Etwas ist schiefgelaufen.",
  tryAgain: "Sie können es noch einmal versuchen.",
  working: "Wird bearbeitet. Das dauert einen Moment. Sie können auf der Seite weiterlesen.",
};

export const SHIELD_LOCALES = { en, fr, es, pt, de } as const;

export type ShieldLocale = keyof typeof SHIELD_LOCALES;

/**
 * A locale name, or a whole table for a language this package does not ship.
 * A table has to be complete: TypeScript enforces it, and a partial one would
 * fall back to English string by string, which is the mixed-language page this
 * file exists to prevent.
 */
export function resolveStrings(locale: ShieldLocale | ShieldStrings | undefined): ShieldStrings {
  if (locale === undefined) return en;
  if (typeof locale === "object") return locale;
  const s = SHIELD_LOCALES[locale];
  if (!s) {
    throw new Error(
      `<Shield> has no strings for locale "${locale}". Shipped: ` +
        `${Object.keys(SHIELD_LOCALES).join(", ")}. Pass a full ShieldStrings table ` +
        `for any other language.`,
    );
  }
  return s;
}

/** True for the shipped English table, whose strings the scripts already know. */
export function isDefaultStrings(s: ShieldStrings): boolean {
  return s === en;
}

/** Replaces each `{key}` with its value. An unknown key is left as written. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
