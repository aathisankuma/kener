// A menu link of the status page that leads to signing in: Kener's sign-in page or the admin area
// (which sends visitors to the sign-in page). Once someone is signed in, the account menu takes its
// place. Links to other sites never count, even when their path looks the same.

export function IsSignInLink(url: string, siteHost: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url, `https://${siteHost || "localhost"}`);
  } catch {
    return false;
  }
  if (siteHost && parsed.host.toLowerCase() !== siteHost.toLowerCase()) return false;
  const path = parsed.pathname.replace(/\/+$/, "");
  return /\/account\/signin$/.test(path) || /(^|\/)manage(\/.*)?$/.test(path);
}
