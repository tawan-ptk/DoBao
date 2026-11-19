// Runs before the page paints. If this device is already signed in, or Google
// has just sent the user back, show the launch screen instead of flashing the
// login page while the app confirms the session.
(function () {
  var html = document.documentElement;
  var returning = /[?&](code|error)=/.test(location.search);
  var stored = false;
  function scan(store) {
    try {
      for (var i = 0; i < store.length; i++)
        if (/^sb-.+-auth-token$/.test(store.key(i))) return true;
    } catch (e) {}
    return false;
  }
  try { stored = scan(window.localStorage) || scan(window.sessionStorage); } catch (e) {}
  if (returning || stored) html.classList.add("auth-resuming");
  if (returning) html.classList.add("auth-returning");
})();
