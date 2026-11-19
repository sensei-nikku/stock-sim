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
var LIVE_RELEASE = {"id":"2026-11-19-v3.3","sha":"aadb100de15a7c5dac418c72bb60cef2cbc57c50","files":{"styles.css":"sha384-pZ3mEWJ+g8l2P2UlH7z2c+aIzT+goPxrCvGxnyZxI+B+CrK94HLefkC4zG/KaI2W","data.js":"sha384-p5e4wQiYPaf2Ps4InimOHFDH/qaGa73AJ5yiEcHpTZIhI9zLgupN0kCxHySbeKcd","persistence.js":"sha384-QCANZRAkLV/slgfo53UwbBoAxBHMO9ZWp7HcaFhr8XHM0NGPvVTpwIVZIbaJ8kWy","game.js":"sha384-gU8x87MnUIBe4wxhbhDCWRQM+0M7wWIFM99TA3JdaY6By/ZyqEEJe40FV4tWk3+m"}};

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
