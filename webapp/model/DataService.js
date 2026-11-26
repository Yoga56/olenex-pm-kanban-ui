sap.ui.define([
  "sap/ui/base/Object",
  "sap/ui/model/Sorter",
  "sap/ui/model/json/JSONModel",
  "sap/base/Log",
  "zpm/kanban/model/dateUtil"
], function (BaseObject, Sorter, JSONModel, Log, U) {
  "use strict";

  // Namespace of the bound action, taken from the service definition name ZUI_PM_KANBAN, version 0001.
  // Check $metadata of the service if the action call returns 404.
  var ACTION_NS = "com.sap.gateway.srvd.zui_pm_kanban.v0001";

  // Fiori launchpad intents used for "jump to the Fiori app".
  // Look up the exact semantic object / action of the standard apps in the launchpad
  // (App Finder / App Descriptor Items) and adjust here. The parameter name is the one the app expects.
  var NAVIGATION = {
    order:        { semanticObject: "MaintenanceOrder",        action: "manage", param: "MaintenanceOrder" },
    notification: { semanticObject: "MaintenanceNotification", action: "manage", param: "MaintenanceNotification" }
  };

  function norm(o) {
    ["MaintOrdBasicStartDate", "MaintOrdBasicEndDate", "ScheduledBasicStartDate",
     "OrderCreationDate", "NotificationReportDate", "NotificationCreatedOn"].forEach(function (f) {
      o[f] = U.iso(U.parse(o[f]));
    });
    return o;
  }

  return BaseObject.extend("zpm.kanban.model.DataService", {

    constructor: function (oComponent, bMock) {
      BaseObject.call(this);
      this._oComponent = oComponent;
      this._bMock = !!bMock;
      this._aMock = null;
    },

    isMock: function () { return this._bMock; },

    /** Loads all maintenance orders (client side filtering/grouping afterwards). */
    load: function () {
      if (this._bMock) {
        return this._mockData().then(function (a) { return a.map(function (o) { return Object.assign({}, o); }); });
      }
      var oModel = this._oComponent.getModel();
      var oList = oModel.bindList("/MaintOrder", null, [new Sorter("MaintOrdBasicStartDate")]);
      return oList.requestContexts(0, 10000).then(function (aCtx) {
        return aCtx.map(function (c) { return norm(Object.assign({}, c.getObject())); });
      });
    },

    /** Calls the RAP action ZR_PM_KANBANORDER~reschedule -> I_MaintenanceOrderTP update. */
    reschedule: function (sOrder, sIsoDate) {
      if (this._bMock) {
        return this._mockData().then(function (a) {
          var o = a.find(function (x) { return x.MaintenanceOrder === sOrder; });
          if (!o) { return Promise.reject(new Error("Order not found")); }
          if (o.KanbanStatus === "40" || o.KanbanStatus === "50") {
            return Promise.reject(new Error("Order is technically completed / closed"));
          }
          var oOld = U.parse(o.MaintOrdBasicStartDate), oNew = U.parse(sIsoDate);
          if (oOld && o.MaintOrdBasicEndDate) {
            o.MaintOrdBasicEndDate = U.iso(U.addDays(U.parse(o.MaintOrdBasicEndDate), U.daysBetween(oOld, oNew)));
          }
          o.MaintOrdBasicStartDate = sIsoDate;
        });
      }
      var oModel = this._oComponent.getModel();
      var sPath = "/MaintOrder('" + encodeURIComponent(sOrder) + "')/" + ACTION_NS + ".reschedule(...)";
      var oAction = oModel.bindContext(sPath);
      oAction.setParameter("NewStartDate", sIsoDate);
      return oAction.execute();
    },

    /** One status step via RAP action changeStatus -> released actions of I_MaintenanceOrderTP. */
    changeStatus: function (sOrder, sTarget) {
      if (this._bMock) {
        var ORDER = ["10", "20", "30", "40", "50"];
        return this._mockData().then(function (a) {
          var o = a.find(function (x) { return x.MaintenanceOrder === sOrder; });
          if (!o) { return Promise.reject(new Error("Order not found")); }
          var iDiff = ORDER.indexOf(sTarget) - ORDER.indexOf(o.KanbanStatus);
          if (Math.abs(iDiff) !== 1 || sTarget === "10") { return Promise.reject(new Error("Status change not supported in one step")); }
          if (sTarget === "40" && /Reparatie/.test(o.MaintenanceOrderDesc)) {      // simulates a business error of the standard BO
            return Promise.reject(new Error("Operations are still open (mock error)"));
          }
          o.KanbanStatus = sTarget;
        });
      }
      var oAction = this._oComponent.getModel().bindContext("/MaintOrder('" + encodeURIComponent(sOrder) + "')/" + ACTION_NS + ".changeStatus(...)");
      oAction.setParameter("TargetStatus", sTarget);
      return oAction.execute();
    },

    /** Opens the standard Fiori app (display/change) via cross-app navigation. */
    navigate: function (sKind, sId) {
      var oNav = NAVIGATION[sKind];
      var oUshell = sap.ushell && sap.ushell.Container;
      if (!oUshell || !oNav || !sId) { return Promise.resolve(false); }
      var oParams = {};
      oParams[oNav.param] = sId;
      return oUshell.getServiceAsync("Navigation").then(function (oService) {
        return oService.navigate({ target: { semanticObject: oNav.semanticObject, action: oNav.action }, params: oParams });
      }).then(function () { return true; });
    },

    _mockData: function () {
      if (!this._aMock) {
        var oModel = new JSONModel();
        this._aMock = oModel.loadData(sap.ui.require.toUrl("zpm/kanban/localService/orders.json")).then(function () {
          var a = oModel.getData();
          a.forEach(norm);
          return a;
        });
      }
      return this._aMock;
    }
  });
});
