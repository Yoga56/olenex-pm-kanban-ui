sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "sap/ui/Device",
  "zpm/kanban/model/DataService"
], function (UIComponent, JSONModel, Device, DataService) {
  "use strict";

  return UIComponent.extend("zpm.kanban.Component", {
    metadata: { manifest: "json" },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(new JSONModel(Device), "device");

      // ?mock=true  -> local sample data, no backend needed (also used for UI tests)
      var bMock = new URLSearchParams(window.location.search).get("mock") === "true";
      this._oDataService = new DataService(this, bMock);
    },

    getDataService: function () {
      return this._oDataService;
    },

    // Fiori guideline: touch -> cozy, mouse/keyboard -> compact; set once for the whole app
    getContentDensityClass: function () {
      if (document.body.classList.contains("sapUiSizeCozy") || document.body.classList.contains("sapUiSizeCompact")) {
        return ""; // the launchpad already set the density
      }
      return Device.support.touch ? "sapUiSizeCozy" : "sapUiSizeCompact";
    }
  });
});
