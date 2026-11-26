sap.ui.define(["sap/base/i18n/Localization"], function (Localization) {
  "use strict";
  // All dates are handled as UTC calendar dates, exchanged with the backend as ISO "YYYY-MM-DD" (Edm.Date).
  var DAY = 86400000;

  var U = {
    /** "YYYY-MM-DD" -> Date (UTC midnight). Initial / invalid values -> null. */
    parse: function (s) {
      if (!s || typeof s !== "string") { return null; }
      if (/^0{4}-0{2}-0{2}$/.test(s) || s.indexOf("0001-01-01") === 0 || s.indexOf("00000000") === 0) { return null; }
      var d = new Date(s.substring(0, 10) + "T00:00:00Z");
      return isNaN(d.getTime()) ? null : d;
    },
    iso: function (d) { return d ? d.toISOString().substring(0, 10) : null; },
    today: function () {
      var n = new Date();
      return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
    },
    addDays: function (d, n) { return new Date(d.getTime() + n * DAY); },
    daysBetween: function (a, b) { return Math.round((b.getTime() - a.getTime()) / DAY); },
    daysInMonth: function (y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); },
    startOfMonth: function (d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); },
    addMonths: function (d, n) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)); },
    startOfWeek: function (d) {                       // Monday
      var wd = (d.getUTCDay() + 6) % 7;
      return U.addDays(d, -wd);
    },
    isoWeek: function (d) {
      var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
      var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
      return Math.ceil(((t - y0) / DAY + 1) / 7);
    },
    /** Display text of a date for the current locale. */
    /** "Oct 12 - 18" (short) or "Oct 12 - 18, 2026" (long). Both dates are ISO strings. */
    range: function (a, b, bYear) {
      var d0 = U.parse(a), d1 = U.parse(b || a);
      if (!d0 || !d1) { return ""; }
      var o = { day: "numeric", month: "short", timeZone: "UTC" };
      if (bYear) { o.year = "numeric"; }
      try { return new Intl.DateTimeFormat(Localization.getLanguage(), o).formatRange(d0, d1); }
      catch (e) { return U.format(a) + (b && b !== a ? " - " + U.format(b) : ""); }
    },
    language: function () { return Localization.getLanguage(); },
    format: function (s) {
      var d = U.parse(s);
      if (!d) { return ""; }
      return new Intl.DateTimeFormat(Localization.getLanguage(),
        { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
    }
  };
  return U;
});
