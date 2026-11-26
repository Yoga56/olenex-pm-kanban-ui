sap.ui.define([], function () {
  "use strict";
  /**
   * Persistence of saved views ("variants") in the browser of the user.
   * Replace load/save by the key user / personalization service (sap.ui.fl) or a user-specific backend table
   * when the views must follow the user to other devices.
   */
  var KEY = "zpm.kanban.variants.v1";
  var mem = null;
  return {
    load: function () {
      try {
        var s = window.localStorage.getItem(KEY);
        if (s) { return JSON.parse(s); }
      } catch (e) { /* storage blocked: keep in memory */ }
      return mem || { defaultId: "__standard", items: [] };
    },
    save: function (o) {
      mem = o;
      try { window.localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* ignore */ }
    }
  };
});
