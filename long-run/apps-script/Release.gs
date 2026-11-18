/**
 * The Long Run — Release.gs   (add this as a NEW script file; nothing else in it)
 *
 * The release gate. Students only ever run the exact files a teacher approved:
 *   Project Settings -> Script Properties -> LIVE_RELEASE = the one-line pin Claude hands you.
 * The pin names a release folder on GitHub and the SHA-384 hash of every file in it.
 * Index.html tells the browser to refuse any file whose bytes don't match its hash
 * (Subresource Integrity), so nothing pushed to GitHub reaches students until the
 * pin here is changed — and only someone who can edit this project can change it.
 *
 * Changing LIVE_RELEASE takes effect on the next page load. No new deployment needed.
 * Missing or malformed pin -> the game shows "not released" instead of loading
 * anything unchecked (fails closed).
 */
var RELEASE_FILES = ['styles.css', 'data.js', 'persistence.js', 'game.js'];

// Called from Index.html while the page is built on the server. Returns JSON or 'null'.
function longRunRelease() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('LIVE_RELEASE');
    if (!raw) return 'null';
    var r = JSON.parse(raw);
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
