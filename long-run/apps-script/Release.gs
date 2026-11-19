/**
 * The Long Run — Release.gs   (its own script file; nothing else in it)
 *
 * The release gate. Everyone runs only the exact files pinned below: a release folder
 * on GitHub and the SHA-384 hash of every file in it. Index.html tells the browser to
 * refuse any file whose bytes don't match (Subresource Integrity), so nothing pushed to
 * GitHub reaches anyone until this pin changes.
 *
 * TO RELEASE (Claude hands you a new copy of this file):
 *   1. paste it over this file, save;
 *   2. open the /dev link and play it — /dev runs what's saved, students don't see it;
 *   3. Deploy -> Manage deployments -> pencil -> Version: New version -> Deploy.
 * TO ROLL BACK: Manage deployments -> pencil -> pick the previous version -> Deploy.
 *
 * A missing or damaged pin makes the game show "not released" instead of loading
 * anything unchecked (fails closed).
 */
var LIVE_RELEASE = {"id":"2026-11-19-v2","sha":"cc8a85f2fa32bea65ca83b744ee1c01f8c218e02","files":{"styles.css":"sha384-KodoLtxrxXL7DK9NFWvdsj2NBD5nSFwrFWh9BYldF8RZPzpAIiJP94NU8govk4gr","data.js":"sha384-AxQauoMON61jXM9Qe3ZDNUPAV4SqFT9tMT4dmVvkg1qZTWVt39/RJK1NGLa/3SrD","persistence.js":"sha384-diKiDmaaGfaVIdWyHgw4JVWvP7A7n+3RwdIOhAfLFfVtFkrxz9vaOygbRGxADkZR","game.js":"sha384-o+TSp2ip4xH/Awnrx69yMX2jeE7HbXW3JYi+0RTcRrhMv2jWSwggNJwZaBP2P31J"}};

var RELEASE_FILES = ['styles.css', 'data.js', 'persistence.js', 'game.js'];

// Called from Index.html while the page is built on the server. Returns JSON or 'null'.
function longRunRelease() {
  try {
    var r = (typeof LIVE_RELEASE === 'string') ? JSON.parse(LIVE_RELEASE) : LIVE_RELEASE;
    var ok = r && /^[A-Za-z0-9._-]{1,40}$/.test(String(r.id)) &&
      /^[0-9a-f]{40}$/.test(String(r.sha)) && r.files &&
      RELEASE_FILES.every(function (f) { return /^sha384-[A-Za-z0-9+\/]{64}$/.test(String(r.files[f] || '')); });
    if (!ok) return 'null';
    var clean = { id: String(r.id), sha: String(r.sha), files: {} };
    RELEASE_FILES.forEach(function (f) { clean.files[f] = String(r.files[f]); });
    return JSON.stringify(clean);   // every field regex-checked above, so this is safe to inline
  } catch (e) {
    return 'null';
  }
}
