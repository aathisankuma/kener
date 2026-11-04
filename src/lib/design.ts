// The look of the public status page, chosen under Customizations → Design. A preset sets every
// option at once; each option can then be changed on its own. The page applies them as
// data-* attributes on <main class="kener-public">, styled in src/routes/designs.css.

export const DESIGN_PRESETS = ["standard", "classic", "cards", "compact", "bold", "portal"] as const;
export type DesignPreset = (typeof DESIGN_PRESETS)[number] | "custom";

export interface DesignSettings {
  preset: DesignPreset;
  /**
   * kener: Kener's page. portal: a service portal: a hero in the brand colour with a picture,
   * services as app cards with icon and status badge on grid pages, and a plain component list
   * with the status on the right on list pages.
   */
  layout: "kener" | "portal";
  /** floating: rounded bar over the page (Kener's default); band: full-width bar in the brand colour. */
  header: "floating" | "band";
  /** outline: status in a bordered box; filled: the box is filled with the status colour. */
  banner: "outline" | "filled";
  /** Corner style of boxes and cards. */
  corners: "round" | "soft" | "square";
  /** joined: services in one box; cards: each service is its own card. */
  monitors: "joined" | "cards";
  /** compact: less space around services and headings. */
  density: "normal" | "compact";
  /** Header band and accents; "" uses the site's accent colour. */
  brandColor: string;
}

type Options = Omit<DesignSettings, "preset" | "brandColor">;

export const DESIGN_PRESET_OPTIONS: Record<(typeof DESIGN_PRESETS)[number], Options> = {
  standard: {
    layout: "kener",
    header: "floating",
    banner: "outline",
    corners: "round",
    monitors: "joined",
    density: "normal",
  },
  classic: {
    layout: "kener",
    header: "band",
    banner: "filled",
    corners: "soft",
    monitors: "joined",
    density: "normal",
  },
  cards: {
    layout: "kener",
    header: "floating",
    banner: "filled",
    corners: "round",
    monitors: "cards",
    density: "normal",
  },
  compact: {
    layout: "kener",
    header: "band",
    banner: "outline",
    corners: "square",
    monitors: "joined",
    density: "compact",
  },
  bold: { layout: "kener", header: "band", banner: "filled", corners: "round", monitors: "cards", density: "normal" },
  portal: {
    layout: "portal",
    header: "band",
    banner: "filled",
    corners: "square",
    monitors: "cards",
    density: "normal",
  },
};

export const DEFAULT_DESIGN: DesignSettings = { preset: "standard", ...DESIGN_PRESET_OPTIONS.standard, brandColor: "" };

const CHOICES: { [K in keyof Options]: readonly Options[K][] } = {
  layout: ["kener", "portal"],
  header: ["floating", "band"],
  banner: ["outline", "filled"],
  corners: ["round", "soft", "square"],
  monitors: ["joined", "cards"],
  density: ["normal", "compact"],
};

const HEX = /^#[0-9a-f]{6}$/i;

/** The preset whose options these are, or "custom". */
export function PresetOf(options: Options): DesignPreset {
  const keys = Object.keys(CHOICES) as Array<keyof Options>;
  const match = DESIGN_PRESETS.find((p) => keys.every((k) => DESIGN_PRESET_OPTIONS[p][k] === options[k]));
  return match ?? "custom";
}

/** A complete, valid design from stored or submitted data; unknown values fall back to the default. */
export function NormalizeDesign(input: unknown): DesignSettings {
  let raw: Record<string, unknown> = {};
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input) ?? {};
    } catch {
      raw = {};
    }
  } else if (input && typeof input === "object") {
    raw = input as Record<string, unknown>;
  }
  const options = {} as Options;
  for (const key of Object.keys(CHOICES) as Array<keyof Options>) {
    const value = raw[key];
    (options as Record<string, string>)[key] = (CHOICES[key] as readonly string[]).includes(String(value))
      ? String(value)
      : DEFAULT_DESIGN[key];
  }
  const brandColor = typeof raw.brandColor === "string" && HEX.test(raw.brandColor) ? raw.brandColor : "";
  return { preset: PresetOf(options), ...options, brandColor };
}

/** True when the value is a design Kener can store: every given option must be a known one. */
export function IsValidDesign(value: unknown): boolean {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      return false;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(CHOICES) as Array<keyof Options>) {
    if (r[key] !== undefined && !(CHOICES[key] as readonly string[]).includes(String(r[key]))) return false;
  }
  if (
    r.brandColor !== undefined &&
    r.brandColor !== "" &&
    !(typeof r.brandColor === "string" && HEX.test(r.brandColor))
  )
    return false;
  return true;
}

/** Cookie with a signed-in person's own choice of design: a preset name, or absent for the site's. */
export const PERSONAL_DESIGN_COOKIE = "kener-design";

/**
 * The design a page shows: the person's own preset when they are signed in and chose one, with the
 * site's brand colour; otherwise the site's design.
 */
export function EffectiveDesign(site: DesignSettings, personal: string | undefined, signedIn: boolean): DesignSettings {
  const preset = (DESIGN_PRESETS as readonly string[]).includes(personal ?? "")
    ? (personal as (typeof DESIGN_PRESETS)[number])
    : null;
  if (!signedIn || !preset) return site;
  return { preset, ...DESIGN_PRESET_OPTIONS[preset], brandColor: site.brandColor };
}
