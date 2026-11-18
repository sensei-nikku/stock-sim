/* The Long Run — Persistence.html
 *
 * Client-side adapter over the server (Code.gs). Deliberately thin: it decides
 * nothing. It just (a) hands the engine the boot payload doGet injected into the
 * page, and (b) turns google.script.run's callback API into awaitable promises.
 *
 * Reveals are NOT fetched by year number. They ride along on boot().reveal and on
 * every advance() result — which is exactly what stops a student from requesting
 * a year they haven't earned. The engine reads the reveal it's given; it can't
 * ask for another.
 *
 * This is the one seam a future standalone (no Apps Script) build would swap out.
 */
var Server = (function () {

  var hasGS = (typeof google !== 'undefined' && google.script && google.script.run);

  function call_(method, args) {
    return new Promise(function (resolve, reject) {
      if (!hasGS) {
        reject(new Error('Not running inside Apps Script — open the deployed web-app link.'));
        return;
      }
      var runner = google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler(function (err) { reject(err); });
      runner[method].apply(runner, args);
    });
  }

  return {

    // True only inside the deployed Apps Script web app.
    available: !!hasGS,

    // What doGet baked into the page:
    //   { email, year, phase, choice, unlockedThrough, state, reveal }
    // or null if the user isn't signed in.
    boot: function () {
      return (typeof window !== 'undefined' && window.LONGRUN_BOOT) ? window.LONGRUN_BOOT : null;
    },

    // The only forward step. Commits `stateBlob`, advances the phase, returns the
    // next reveal. RESOLVES with the server object even on logical failure:
    //   { ok:true,  year, phase, choice, unlockedThrough, done, reveal }
    //   { ok:false, stale:true, boot }   -> student reloaded/replayed; resync to boot
    //   { ok:false, error }              -> something went wrong; show it
    // It REJECTS only on a transport/server exception.
    advance: function (year, phase, stateBlob, choice) {
      return call_('advance', [year, phase, stateBlob, choice]);
    },

    // Teacher dashboard. Resolves { ok:true, students:[...] } or { ok:false, error }.
    getClassData: function () {
      return call_('getClassData', []);
    },

    // Wipe the caller's OWN game back to year 1 (teacher testing).
    // Resolves { ok:true, boot } with a fresh boot payload.
    resetMe: function () {
      return call_('resetMe', []);
    },

    // Teacher only: wipe a named STUDENT's game back to year 1. Resolves { ok }.
    resetStudent: function (email) {
      return call_('resetStudent', [email]);
    }

  };
})();
