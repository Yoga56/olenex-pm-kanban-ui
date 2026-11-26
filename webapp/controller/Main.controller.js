sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/core/Fragment",
  "sap/ui/model/Sorter",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/m/Column",
  "sap/m/ColumnListItem",
  "sap/m/Text",
  "sap/m/Link",
  "sap/m/ObjectStatus",
  "sap/m/VBox",
  "zpm/kanban/model/dateUtil",
  "zpm/kanban/model/columns",
  "zpm/kanban/model/VariantStore"
], function (Controller, JSONModel, Fragment, Sorter, Filter, FilterOperator, MessageToast, MessageBox,
             Column, ColumnListItem, Text, Link, ObjectStatus, VBox, U, COLS, VariantStore) {
  "use strict";

  // Value states (semantic colors) - every state is accompanied by text, as required by the guidelines.
  var STATUS_STATE = { "10": "None", "20": "Information", "30": "Information", "40": "Success", "50": "None" };
  var STATUS_ORDER = ["10", "20", "30", "40", "50"];
  var KANBAN_MAX_CARDS = 100;
  var PAGE_PADDING_PX = 112;     // side paddings + scrollbar around the table
  var MONTH_COUNT = 12, WEEK_COUNT = 13;
  var DEFAULT_FILTERS = function () {
    return { plants: [], plannerGroups: [], workCenters: [], statuses: [], search: "", hideClosed: true };
  };

  function strip0(s) { return (s || "").replace(/^0+/, ""); }
  function movable(o) { return o.KanbanStatus !== "40" && o.KanbanStatus !== "50"; }

  return Controller.extend("zpm.kanban.controller.Main", {

    onInit: function () {
      var oView = this.getView(), oComp = this.getOwnerComponent();
      this._oBundle = oComp.getModel("i18n").getResourceBundle();
      this._oData = oComp.getDataService();
      this._aAll = [];
      this._oLastMove = null;

      // content density is set once for the whole app (compact for mouse/keyboard, cozy for touch)
      var sDensity = oComp.getContentDensityClass();
      if (sDensity) { oView.addStyleClass(sDensity); }

      var oToday = U.today();
      oView.setModel(new JSONModel({
        mock: this._oData.isMock(),
        tab: "list",
        counts: { list: 0, kanban: 0, schedule: 0 },
        filterInfo: "",
        undo: { visible: false, text: "" },
        filters: DEFAULT_FILTERS(),
        options: { plants: [], plannerGroups: [], workCenters: [], statuses: this._statusOptions() },
        list: [], kanban: [],
        cardLayout: "compact",
        rowDetails: "less",
        tbl: { columns: COLS.defaults.slice(), sort: [{ key: "planStart", dir: "asc" }], group: "" },
        variants: { list: [], currentId: "__standard", title: "", modified: false, canSave: false },
        schedule: { rowsBy: "FunctionalLocation", granularity: "month", rangeText: "",
                    windowStart: U.iso(U.addMonths(oToday, -1)), periods: [], rows: [] }
      }), "view");
      this._oDlg = new JSONModel({});
      // models of the view settings dialog, "save as" dialog and "manage views" dialog
      this._oVs = new JSONModel({}); oView.setModel(this._oVs, "vs");
      this._oSa = new JSONModel({}); oView.setModel(this._oSa, "sa");
      this._oMg = new JSONModel({}); oView.setModel(this._oMg, "mg");
      this._oEx = new JSONModel({}); oView.setModel(this._oEx, "ex");
      this._store = VariantStore.load();

      // Ctrl+Z reverts the last drag and drop (guideline: Ctrl+Z is reserved for undo)
      this._fnKey = function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === "z" && this._oLastMove && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
          e.preventDefault();
          this.onUndo();
        }
      }.bind(this);
      document.addEventListener("keydown", this._fnKey);

      // keyboard alternative to dragging a Kanban card: Alt+Left / Alt+Right changes the status
      this.byId("kanban").addEventDelegate({ onkeydown: this._onKanbanKey.bind(this) });

      this._initVariants();      // applies the default saved view (filters + table settings) and builds the table
      this._load();

      // page chrome (title, header, tabs, content) must never scroll sideways - only the table, the Kanban board and the schedule board do.
      // If a focus/drag/trackpad gesture still moves one of them, put it back so header and content stay aligned.
      this._fnScroll = function (e) {
        var t = e.target === document ? document.scrollingElement : e.target;
        if (t && t.scrollLeft && t.className && /sapFDynamicPage|sapFSemanticPage|sapMITBContainerContent|sapMITBContent|sapUiView|sapUiBody/.test(String(t.className)) || t === document.scrollingElement && t.scrollLeft) {
          t.scrollLeft = 0;
        }
      };
      document.addEventListener("scroll", this._fnScroll, true);
    },

    onExit: function () {
      document.removeEventListener("keydown", this._fnKey);
      document.removeEventListener("scroll", this._fnScroll, true);
    },

    // ------------------------------------------------------------ data
    _load: function () {
      var oView = this.getView();
      oView.setBusy(true);
      return this._oData.load().then(function (aData) {
        this._aAll = aData.map(this._enrich.bind(this));
        this._buildOptions();
        this._refresh();
      }.bind(this)).catch(function (e) {
        MessageBox.error(this._oBundle.getText("loadFailed", [e && e.message || e]));
      }.bind(this)).finally(function () { oView.setBusy(false); });
    },

    _enrich: function (o) {
      var oToday = U.today(), oStart = U.parse(o.MaintOrdBasicStartDate);
      o.OrderText = strip0(o.MaintenanceOrder);
      o.NotificationText = strip0(o.MaintenanceNotification);
      o.EquipmentText = strip0(o.Equipment);
      o.StatusText = this._oBundle.getText("status" + o.KanbanStatus);
      o.StatusState = STATUS_STATE[o.KanbanStatus] || "None";
      o.IsOverdue = !!oStart && oStart < oToday && (o.KanbanStatus === "10" || o.KanbanStatus === "20");
      this._dates(o);
      return o;
    },
    _dates: function (o) {
      o.StartDateText = U.format(o.MaintOrdBasicStartDate);
      o.EndDateText = U.format(o.MaintOrdBasicEndDate);
      o.CreatedText = U.format(o.OrderCreationDate);
      o.ReportDateText = U.format(o.NotificationReportDate);
      o.NotifCreatedText = U.format(o.NotificationCreatedOn);
      this._facts(o);
    },

    /** Texts of the Kanban card: every value gets a label so nobody has to guess what a number means. */
    _facts: function (o) {
      var b = this._oBundle;
      function fact(sKey, sValue) { return sValue ? { label: b.getText(sKey) + ":", value: sValue } : null; }
      var sFuncLoc = [o.FunctionalLocation, o.FunctionalLocationName].filter(Boolean).join(" · ");
      var sEquip = o.EquipmentName ? o.EquipmentName + (o.EquipmentText ? " (" + o.EquipmentText + ")" : "") : o.EquipmentText;
      o.OrderTitle = b.getText("orderTitle", [o.OrderText]);
      o.StartDateStatusText = o.StartDateText ? o.StartDateText + (o.IsOverdue ? " · " + b.getText("overdueSuffix") : "") : "–";
      o.Facts = [fact("colFuncLoc", sFuncLoc), fact("colEquipment", sEquip), fact("colWorkCenter", o.MainWorkCenter)].filter(Boolean);
      o.FactsMore = [fact("colPlant", o.MaintenancePlanningPlant), fact("colPlannerGroup", o.MaintenancePlannerGroup),
                     fact("factNotification", o.NotificationText), fact("factReportDate", o.ReportDateText),
                     fact("factCreated", o.CreatedText)].filter(Boolean);
    },

    _statusOptions: function () {
      return ["10", "20", "30", "40", "50"].map(function (k) {
        return { key: k, text: this._oBundle.getText("status" + k) };
      }, this);
    },
    _distinct: function (sField) {
      var m = {};
      this._aAll.forEach(function (o) { if (o[sField]) { m[o[sField]] = true; } });
      return Object.keys(m).sort().map(function (k) { return { key: k, text: k }; });
    },
    _buildOptions: function () {
      var oM = this.getView().getModel("view");
      oM.setProperty("/options/plants", this._distinct("MaintenancePlanningPlant"));
      oM.setProperty("/options/plannerGroups", this._distinct("MaintenancePlannerGroup"));
      oM.setProperty("/options/workCenters", this._distinct("MainWorkCenter"));
    },

    // ------------------------------------------------------------ filtering
    _filtered: function () {
      var f = this.getView().getModel("view").getProperty("/filters");
      var sQ = (f.search || "").trim().toLowerCase();
      function inSel(a, v) { return !a.length || a.indexOf(v) >= 0; }
      return this._aAll.filter(function (o) {
        if (f.hideClosed && o.KanbanStatus === "50") { return false; }
        if (!inSel(f.plants, o.MaintenancePlanningPlant) || !inSel(f.plannerGroups, o.MaintenancePlannerGroup) ||
            !inSel(f.workCenters, o.MainWorkCenter) || !inSel(f.statuses, o.KanbanStatus)) { return false; }
        if (sQ) {
          var s = [o.OrderText, o.MaintenanceOrderDesc, o.FunctionalLocation, o.FunctionalLocationName,
                   o.EquipmentText, o.EquipmentName, o.NotificationText, o.MainWorkCenter, o.MaintenancePlannerGroup].join(" ").toLowerCase();
          if (s.indexOf(sQ) < 0) { return false; }
        }
        return true;
      });
    },

    /** "Filter information" shown in the snapped header: n filters active + list of up to five. */
    _filterInfo: function () {
      var f = this.getView().getModel("view").getProperty("/filters"), b = this._oBundle, a = [];
      function add(sNameKey, aVals) { if (aVals.length) { a.push(b.getText(sNameKey) + " (" + aVals.join(", ") + ")"); } }
      add("filterNamePlant", f.plants);
      add("filterNamePlanner", f.plannerGroups);
      add("filterNameWorkCenter", f.workCenters);
      add("filterNameStatus", f.statuses.map(function (k) { return b.getText("status" + k); }));
      if ((f.search || "").trim()) { a.push(b.getText("filterNameSearch") + " (" + f.search.trim() + ")"); }
      if (f.hideClosed) { a.push(b.getText("filterNameHideClosed")); }
      if (!a.length) { return b.getText("filterInfoNone"); }
      return b.getText(a.length === 1 ? "filterInfoOne" : "filterInfoN",
        [a.length, a.slice(0, 5).join(", ") + (a.length > 5 ? ", …" : "")]);
    },

    _refresh: function () {
      var oM = this.getView().getModel("view"), a = this._filtered();
      a.sort(function (x, y) {
        return (x.MaintOrdBasicStartDate || "9999").localeCompare(y.MaintOrdBasicStartDate || "9999") ||
               x.MaintenanceOrder.localeCompare(y.MaintenanceOrder);
      });
      oM.setProperty("/filterInfo", this._filterInfo());
      oM.setProperty("/counts/list", a.length);
      oM.setProperty("/counts/kanban", a.length);
      oM.setProperty("/list", a);
      oM.setProperty("/kanban", this._buildKanban(a));
      this._buildSchedule(a);
      this._checkModified();
    },

    _buildKanban: function (a) {
      return ["10", "20", "30", "40", "50"].map(function (k) {
        var aCol = a.filter(function (o) { return o.KanbanStatus === k; });
        return {
          key: k,
          title: this._oBundle.getText("status" + k),
          count: aCol.length,
          countText: this._oBundle.getText("ordersCount", [aCol.length]),
          cards: aCol.slice(0, KANBAN_MAX_CARDS),
          moreText: aCol.length > KANBAN_MAX_CARDS ? this._oBundle.getText("moreCards", [aCol.length - KANBAN_MAX_CARDS]) : ""
        };
      }, this);
    },

    // ------------------------------------------------------------ schedule
    _periodDefs: function () {
      var s = this.getView().getModel("view").getProperty("/schedule");
      var oFrom = U.parse(s.windowStart), oToday = U.today(), a = [], i, n;
      if (s.granularity === "week") {
        oFrom = U.startOfWeek(oFrom); n = WEEK_COUNT;
        for (i = 0; i < n; i++) {
          var w0 = U.addDays(oFrom, 7 * i), w1 = U.addDays(w0, 6);
          a.push({ start: U.iso(w0), end: U.iso(w1), label: "W" + U.isoWeek(w0),
                   sublabel: U.range(U.iso(w0), U.iso(w1)), title: U.range(U.iso(w0), U.iso(w1), true),
                   current: oToday >= w0 && oToday <= w1 });
        }
      } else {
        oFrom = U.startOfMonth(oFrom); n = MONTH_COUNT;
        var oFmt = new Intl.DateTimeFormat(U.language(), { month: "short", year: "numeric", timeZone: "UTC" });
        for (i = 0; i < n; i++) {
          var m0 = U.addMonths(oFrom, i), m1 = U.addDays(U.addMonths(m0, 1), -1);
          a.push({ start: U.iso(m0), end: U.iso(m1), label: oFmt.format(m0),
                   sublabel: U.range(U.iso(m0), U.iso(m1)), title: U.range(U.iso(m0), U.iso(m1), true),
                   current: oToday >= m0 && oToday <= m1 });
        }
      }
      return a;
    },

    _periodIndex: function (aPeriods, sIso) {
      for (var i = 0; i < aPeriods.length; i++) {
        if (sIso >= aPeriods[i].start && sIso <= aPeriods[i].end) { return i; }
      }
      return -1;
    },

    _chip: function (o) {
      var sState = (o.KanbanStatus === "30" || o.KanbanStatus === "40" || o.KanbanStatus === "50") ? "Success"
                 : (o.IsOverdue ? "Error" : "Information");
      var sStateText = this._oBundle.getText(sState === "Success" ? "statusIconDone" : sState === "Error" ? "statusIconOverdue" : "statusIconOpen");
      return {
        id: o.MaintenanceOrder,
        num: o.OrderText,
        desc: o.MaintenanceOrderDesc || "",
        dateText: U.range(o.MaintOrdBasicStartDate, o.MaintOrdBasicEndDate),
        tooltip: o.OrderText + " · " + (o.MaintenanceOrderDesc || "") + "\n" + o.StatusText + " (" + sStateText + ")" +
                 (o.StartDateText ? "\n" + this._oBundle.getText("colPlanStart") + ": " + U.range(o.MaintOrdBasicStartDate, o.MaintOrdBasicEndDate, true) : ""),
        state: sState,
        draggable: movable(o)
      };
    },

    _buildSchedule: function (aOrders) {
      var oM = this.getView().getModel("view"), s = oM.getProperty("/schedule");
      var aP = this._periodDefs(), mRows = {}, sKeyField = s.rowsBy, sNone = this._oBundle.getText("noKey"), iShown = 0;
      var iLast = aP.length - 1, sWinStart = aP[0].start, sWinEnd = aP[iLast].end;

      aOrders.forEach(function (o) {
        var sKey = o[sKeyField] || "";
        var r = mRows[sKey];
        if (!r) {
          r = mRows[sKey] = { key: sKey, title: sKey ? (sKeyField === "Equipment" ? strip0(sKey) : sKey) : sNone,
                              subtitle: "", unscheduled: [], bars: [], lanes: 1, n: 0 };
        }
        if (!r.subtitle) {
          r.subtitle = (sKeyField === "FunctionalLocation" ? o.FunctionalLocationName :
                        sKeyField === "Equipment" ? o.EquipmentName : "") || "";
        }
        var sStart = o.MaintOrdBasicStartDate;
        if (!sStart) { r.unscheduled.push(this._chip(o)); r.n++; return; }
        // an order is a bar from its plan start to its plan end (an open end = one day); it is shown when it overlaps the window
        var sEnd = o.MaintOrdBasicEndDate && o.MaintOrdBasicEndDate >= sStart ? o.MaintOrdBasicEndDate : sStart;
        if (sEnd < sWinStart || sStart > sWinEnd) { return; }
        var c = this._chip(o);
        c.from = sStart < sWinStart ? 0 : this._periodIndex(aP, sStart);
        c.to = sEnd > sWinEnd ? iLast : this._periodIndex(aP, sEnd);
        c.clipL = sStart < sWinStart;
        c.clipR = sEnd > sWinEnd;
        if (c.from < 0 || c.to < c.from) { return; }
        r.bars.push(c); r.n++; iShown++;
      }, this);

      var aRows = Object.keys(mRows).sort().map(function (k) { return mRows[k]; })
                        .filter(function (r) { return r.n > 0; });
      aRows.forEach(function (r) {      // lanes: bars that overlap in time go under each other
        var aEnd = [];
        r.bars.sort(function (a, b) { return a.from - b.from || a.to - b.to; }).forEach(function (b) {
          var l = aEnd.findIndex(function (e) { return e < b.from; });
          if (l < 0) { l = aEnd.length; }
          aEnd[l] = b.to; b.lane = l;
        });
        r.lanes = Math.max(1, aEnd.length, r.unscheduled.length);
      });
      oM.setProperty("/schedule/periods", aP);
      oM.setProperty("/schedule/rows", aRows);
      oM.setProperty("/counts/schedule", iShown);
      oM.setProperty("/schedule/rangeText", this._oBundle.getText("scheduleRange", [U.range(aP[0].start, aP[iLast].end, true)]));
      this._aPeriods = aP;
    },

    /** New start date when an order chip is dropped into period #i. */
    _targetDate: function (o, iPeriod) {
      var oP0 = U.parse(this._aPeriods[iPeriod].start), oOld = U.parse(o.MaintOrdBasicStartDate);
      var sGran = this.getView().getModel("view").getProperty("/schedule/granularity"), oNew;
      if (!oOld) {
        oNew = oP0;
        var oToday = U.today();
        if (oNew < oToday && oToday <= U.parse(this._aPeriods[iPeriod].end)) { oNew = oToday; }
      } else if (sGran === "week") {
        oNew = U.addDays(oP0, U.daysBetween(U.startOfWeek(oOld), oOld));
      } else {
        var iDay = Math.min(oOld.getUTCDate(), U.daysInMonth(oP0.getUTCFullYear(), oP0.getUTCMonth()));
        oNew = new Date(Date.UTC(oP0.getUTCFullYear(), oP0.getUTCMonth(), iDay));
      }
      return U.iso(oNew);
    },

    _find: function (sId) {
      return this._aAll.find(function (x) { return x.MaintenanceOrder === sId; });
    },

    /** Single place that changes a plan start date (drag and drop, dialog, undo). */
    _moveTo: function (o, sNew, bUndo) {
      if (!o || !sNew || sNew === o.MaintOrdBasicStartDate || !movable(o)) { return Promise.resolve(); }
      var oView = this.getView(), oM = oView.getModel("view");
      var oBefore = { s: o.MaintOrdBasicStartDate, e: o.MaintOrdBasicEndDate };

      // optimistic update, reverted when the backend rejects the change
      var oOldD = U.parse(oBefore.s);
      if (oOldD && o.MaintOrdBasicEndDate) {
        o.MaintOrdBasicEndDate = U.iso(U.addDays(U.parse(o.MaintOrdBasicEndDate), U.daysBetween(oOldD, U.parse(sNew))));
      }
      o.MaintOrdBasicStartDate = sNew;
      this._enrich(o);
      this._refresh();

      oView.setBusy(true);
      return this._oData.reschedule(o.MaintenanceOrder, sNew).then(function () {
        if (bUndo) {
          MessageToast.show(this._oBundle.getText("undoDone", [o.OrderText, U.format(sNew)]));
          this._oLastMove = null;
          oM.setProperty("/undo", { visible: false, text: "" });
        } else {
          MessageToast.show(this._oBundle.getText("rescheduleOk", [o.OrderText, U.format(sNew)]));
          if (oBefore.s) {      // an unscheduled order cannot be un-scheduled again
            this._oLastMove = { kind: "date", id: o.MaintenanceOrder, start: oBefore.s };
            oM.setProperty("/undo", { visible: true, text: this._oBundle.getText("undoText", [o.OrderText]) });
          } else {
            this._oLastMove = null;
            oM.setProperty("/undo", { visible: false, text: "" });
          }
        }
      }.bind(this)).catch(function (e) {
        o.MaintOrdBasicStartDate = oBefore.s;
        o.MaintOrdBasicEndDate = oBefore.e;
        this._enrich(o);
        this._refresh();
        MessageBox.error(this._oBundle.getText("rescheduleFailed", [o.OrderText, e && e.message || e]));
      }.bind(this)).finally(function () { oView.setBusy(false); });
    },

    onReschedule: function (oEvent) {
      var o = this._find(oEvent.getParameter("orderId")), iP = oEvent.getParameter("periodIndex");
      if (o && iP >= 0) { this._moveTo(o, this._targetDate(o, iP)); }
    },

    onUndo: function () {
      var m = this._oLastMove, o = m && this._find(m.id);
      this._oLastMove = null;
      this.getView().getModel("view").setProperty("/undo", { visible: false, text: "" });
      if (!o) { return; }
      if (m.kind === "status") {
        this._doStatusChange(o, this._statusPath(o.KanbanStatus, m.status), true);
      } else {
        this._moveTo(o, m.start, true);
      }
    },

    // ------------------------------------------------------------ Kanban: status change by drag and drop
    /**
     * Steps from one status to another, one released action per step.
     * Returns [] when nothing changes and null when impossible (a released order cannot go back to "Created").
     */
    _statusPath: function (sFrom, sTo) {
      var i = STATUS_ORDER.indexOf(sFrom), j = STATUS_ORDER.indexOf(sTo), a = [], k;
      if (i < 0 || j < 0 || i === j) { return []; }
      if (j > i) {
        for (k = i + 1; k <= j; k++) { a.push(STATUS_ORDER[k]); }
      } else {
        if (j === 0) { return null; }
        for (k = i - 1; k >= j; k--) { a.push(STATUS_ORDER[k]); }
      }
      return a;
    },

    onKanbanDragStart: function (oEvent) {
      var o = oEvent.getParameter("target").getBindingContext("view").getObject();
      oEvent.getParameter("dragSession").setComplexData("kanban", { id: o.MaintenanceOrder });
    },

    onKanbanDrop: function (oEvent) {
      var oData = oEvent.getParameter("dragSession").getComplexData("kanban");
      var oCtx = oEvent.getParameter("droppedControl").getBindingContext("view");
      var o = oData && this._find(oData.id);
      if (!o || !oCtx) { return; }
      var iCol = parseInt(oCtx.getPath().split("/")[2], 10);     // /kanban/<col>[/cards/<n>]
      this._requestStatusChange(o, this.getView().getModel("view").getProperty("/kanban/" + iCol + "/key"));
    },

    _onKanbanKey: function (oEvent) {
      var sKey = oEvent.key || (oEvent.originalEvent && oEvent.originalEvent.key);
      if (!oEvent.altKey || (sKey !== "ArrowRight" && sKey !== "ArrowLeft")) { return; }
      var oItem = oEvent.srcControl;
      while (oItem && !(oItem.isA && oItem.isA("sap.m.ObjectListItem"))) { oItem = oItem.getParent(); }
      var oCtx = oItem && oItem.getBindingContext("view");
      if (!oCtx) { return; }
      oEvent.preventDefault();
      oEvent.stopPropagation();
      var o = oCtx.getObject(), i = STATUS_ORDER.indexOf(o.KanbanStatus) + (sKey === "ArrowRight" ? 1 : -1);
      if (i >= 0 && i < STATUS_ORDER.length) { this._requestStatusChange(o, STATUS_ORDER[i]); }
    },

    /** Validates and (for consequential changes) confirms, then runs the steps. */
    _requestStatusChange: function (o, sTarget) {
      var aPath = this._statusPath(o.KanbanStatus, sTarget), b = this._oBundle;
      if (aPath === null) { MessageToast.show(b.getText("statusNotRevertible")); return; }
      if (!aPath.length) { return; }
      var bBackward = STATUS_ORDER.indexOf(sTarget) < STATUS_ORDER.indexOf(o.KanbanStatus);
      var bConsequential = bBackward || sTarget === "40" || sTarget === "50";
      if (!bConsequential) { this._doStatusChange(o, aPath); return; }
      var aNames = aPath.map(function (k) { return b.getText("status" + k); });
      var sText = aPath.length > 1
        ? b.getText("statusConfirmSteps", [o.OrderText, o.StatusText, b.getText("status" + sTarget), aNames.join(" → ")])
        : b.getText("statusConfirm", [o.OrderText, o.StatusText, b.getText("status" + sTarget)]);
      MessageBox.confirm(sText, {
        title: b.getText("statusConfirmTitle"),
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        emphasizedAction: MessageBox.Action.OK,
        onClose: function (sAction) { if (sAction === MessageBox.Action.OK) { this._doStatusChange(o, aPath); } }.bind(this)
      });
    },

    /** Runs the status steps one after the other (every step is its own request and commit). */
    _doStatusChange: function (o, aPath, bUndo) {
      if (!aPath || !aPath.length) { return Promise.resolve(); }
      var oView = this.getView(), oM = oView.getModel("view"), b = this._oBundle, sFrom = o.KanbanStatus, p = Promise.resolve();
      oView.setBusy(true);
      aPath.forEach(function (sStep) {
        p = p.then(function () {
          return this._oData.changeStatus(o.MaintenanceOrder, sStep).then(function () {
            o.KanbanStatus = sStep;      // the order really is in this status now, also when a later step fails
            this._enrich(o);
            this._refresh();
          }.bind(this));
        }.bind(this));
      }, this);
      return p.then(function () {
        var sTo = b.getText("status" + o.KanbanStatus);
        if (bUndo) {
          MessageToast.show(b.getText("statusUndone", [o.OrderText, sTo]));
          this._oLastMove = null;
          oM.setProperty("/undo", { visible: false, text: "" });
        } else {
          MessageToast.show(b.getText("statusChanged", [o.OrderText, sTo]));
          if (this._statusPath(o.KanbanStatus, sFrom)) {      // only offer undo when the way back exists
            this._oLastMove = { kind: "status", id: o.MaintenanceOrder, status: sFrom };
            oM.setProperty("/undo", { visible: true, text: b.getText("undoStatusText", [o.OrderText]) });
          } else {
            this._oLastMove = null;
            oM.setProperty("/undo", { visible: false, text: "" });
          }
        }
      }.bind(this)).catch(function (e) {
        MessageBox.error(b.getText("statusFailed", [o.OrderText, e && e.message || e]));
      }).finally(function () { oView.setBusy(false); });
    },
    onDismissUndo: function () {
      this._oLastMove = null;
      this.getView().getModel("view").setProperty("/undo", { visible: false, text: "" });
    },

    onScheduleChange: function () { this._refresh(); },
    _shift: function (n) {
      var oM = this.getView().getModel("view"), s = oM.getProperty("/schedule");
      var oFrom = U.parse(s.windowStart);
      oFrom = s.granularity === "week" ? U.addDays(oFrom, 7 * n) : U.addMonths(oFrom, n);
      oM.setProperty("/schedule/windowStart", U.iso(oFrom));
      this._refresh();
    },
    onSchedulePrev: function () { this._shift(-4); },
    onScheduleNext: function () { this._shift(4); },
    onScheduleToday: function () {
      var oM = this.getView().getModel("view");
      var d = U.today();
      oM.setProperty("/schedule/windowStart", U.iso(oM.getProperty("/schedule/granularity") === "week" ? U.addDays(d, -7) : U.addMonths(d, -1)));
      this._refresh();
    },

    // ------------------------------------------------------------ change-date dialog (keyboard / non-drag alternative)
    onBoardOrderPress: function (oEvent) {
      var o = this._find(oEvent.getParameter("orderId"));
      if (!o) { return; }
      var b = this._oBundle, bMov = movable(o);
      this._oDlg.setData({
        id: o.MaintenanceOrder,
        title: b.getText("dlgTitle", [o.OrderText]),
        desc: o.MaintenanceOrderDesc,
        statusText: o.StatusText, statusState: o.StatusState,
        funcLoc: [o.FunctionalLocation, o.FunctionalLocationName].filter(Boolean).join(" - "),
        equipment: [o.EquipmentText, o.EquipmentName].filter(Boolean).join(" - "),
        workCenter: o.MainWorkCenter,
        startText: o.StartDateText, endText: o.EndDateText,
        newStart: o.MaintOrdBasicStartDate, movable: bMov, canSave: false
      });
      var oView = this.getView();
      this._pDialog = this._pDialog || Fragment.load({ id: oView.getId(), name: "zpm.kanban.view.OrderDialog", controller: this })
        .then(function (oDialog) {
          oView.addDependent(oDialog);
          oDialog.setModel(this._oDlg, "dlg");
          return oDialog;
        }.bind(this));
      this._pDialog.then(function (oDialog) { oDialog.open(); });
    },
    onDlgDateChange: function () {
      var d = this._oDlg.getData(), o = this._find(d.id);
      this._oDlg.setProperty("/canSave", !!d.newStart && !!o && d.newStart !== o.MaintOrdBasicStartDate && d.movable);
    },
    onDlgSave: function () {
      var d = this._oDlg.getData();
      this._pDialog.then(function (oDialog) { oDialog.close(); });
      this._moveTo(this._find(d.id), d.newStart);
    },
    onDlgOpenOrder: function () {
      var o = this._find(this._oDlg.getProperty("/id"));
      if (o) { this._open("order", o.MaintenanceOrder, o.OrderText); }
    },
    onDlgClose: function () { this._pDialog.then(function (oDialog) { oDialog.close(); }); },


    // ------------------------------------------------------------ list: columns, sorting, grouping
    _fragment: function (sName) {
      this._mFrag = this._mFrag || {};
      if (!this._mFrag[sName]) {
        var oView = this.getView();
        this._mFrag[sName] = Fragment.load({ id: oView.getId(), name: "zpm.kanban.view." + sName, controller: this })
          .then(function (o) { oView.addDependent(o); return o; });
      }
      return this._mFrag[sName];
    },

    _sorter: function (sKey, bDesc, bGroup) {
      var d = COLS.byKey[sKey], sPath = d.sortField || d.field, b = this._oBundle;
      var oSorter = new Sorter(sPath, !!bDesc, bGroup ? function (oCtx) {
        var v = oCtx.getProperty(sPath), t = oCtx.getProperty(d.field);
        return { key: String(v == null ? "" : v), text: b.getText("groupHeader", [b.getText(d.label), t || b.getText("groupEmpty")]) };
      } : false);
      oSorter.fnCompare = function (x, y) {                    // empty values last, numbers inside text in natural order
        var ex = x == null || x === "", ey = y == null || y === "";
        if (ex || ey) { return ex && ey ? 0 : (ex ? 1 : -1); }
        return typeof x === "string" ? x.localeCompare(y, undefined, { numeric: true }) : (x < y ? -1 : (x > y ? 1 : 0));
      };
      return oSorter;
    },

    _createCell: function (d) {
      var b = this._oBundle, f = "view>";
      var fnErr = function (v) { return v ? "Error" : "None"; };
      switch (d.type) {
        case "order":
          return new Link({ text: "{view>OrderText}", press: this.onOpenOrder.bind(this), tooltip: b.getText("openDisplay") });
        case "notification":
          return new Link({ text: "{view>NotificationText}", press: this.onOpenNotification.bind(this),
                            visible: { path: "view>NotificationText", formatter: function (v) { return !!v; } } });
        case "status":
          return new ObjectStatus({ text: "{view>StatusText}", state: "{view>StatusState}" });
        case "planStart":
          return new ObjectStatus({ text: "{view>StartDateText}", state: { path: "view>IsOverdue", formatter: fnErr },
            icon: { path: "view>IsOverdue", formatter: function (v) { return v ? "sap-icon://alert" : ""; } },
            tooltip: { path: "view>IsOverdue", formatter: function (v) { return v ? b.getText("overdue") : ""; } } });
        case "two":
          return new VBox({ items: [new Text({ text: "{" + f + d.field + "}" }), new Text({ text: "{" + f + d.sub + "}" }).addStyleClass("pmMeta")] });
        default:
          return new Text({ text: "{" + f + d.field + "}", maxLines: 2 });
      }
    },

    /** Builds columns, cells, sorting and grouping of the list from the current view settings. */
    _buildTable: function () {
      var oTable = this.byId("orderTable"), oM = this.getView().getModel("view"), s = oM.getProperty("/tbl"), b = this._oBundle;
      var aKeys = s.columns.filter(function (k) { return COLS.byKey[k]; });
      oTable.unbindItems();
      oTable.removeAllColumns().forEach(function (c) { c.destroy(); });
      // Pop-in breakpoints: the columns are added by importance (High, Medium, Low). A column is shown only when the window
      // is wide enough for it and all more important columns - so the table never grows wider than its container.
      var mRank = { High: 0, Medium: 1, Low: 2 }, fCum = 0, mMin = {};
      aKeys.map(function (k, i) { return { k: k, i: i }; })
        .sort(function (x, y) { return (mRank[COLS.byKey[x.k].importance] - mRank[COLS.byKey[y.k].importance]) || (x.i - y.i); })
        .forEach(function (o) {
          fCum += parseFloat(COLS.byKey[o.k].width);
          mMin[o.k] = Math.ceil(fCum * 16 + PAGE_PADDING_PX) + "px";
        });
      aKeys.forEach(function (k) {
        var d = COLS.byKey[k];
        oTable.addColumn(new Column({ header: new Text({ text: b.getText(d.label), wrapping: false }), importance: d.importance,
                                      width: d.width, demandPopin: true, minScreenWidth: mMin[k] }));
      });
      this._applyRowDetails();
      var aSort = [];
      if (s.group && COLS.byKey[s.group]) { aSort.push(this._sorter(s.group, false, true)); }
      s.sort.forEach(function (x) { if (x.key && COLS.byKey[x.key]) { aSort.push(this._sorter(x.key, x.dir === "desc", false)); } }, this);
      oTable.bindItems({ path: "view>/list", templateShareable: false, sorter: aSort,
        template: new ColumnListItem({ cells: aKeys.map(function (k) { return this._createCell(COLS.byKey[k]); }, this) }) });
    },

    onViewSettings: function () {
      this._vsLoad(this.getView().getModel("view").getProperty("/tbl"));
      this._fragment("ViewSettings").then(function (oDialog) { this._vsFilter(); oDialog.open(); }.bind(this));
    },
    _vsLoad: function (s) {
      var b = this._oBundle, aSel = s.columns.filter(function (k) { return COLS.byKey[k]; });
      var aOpts = COLS.all.map(function (d) { return { key: d.key, text: b.getText(d.label) }; });
      this._oVs.setData({
        columns: aSel.map(function (k) { return { key: k, text: b.getText(COLS.byKey[k].label), selected: true }; })
          .concat(COLS.all.filter(function (d) { return aSel.indexOf(d.key) < 0; })
            .map(function (d) { return { key: d.key, text: b.getText(d.label), selected: false }; })),
        search: "", hideUnselected: false, allSelected: false, columnsTitle: "",
        sort: s.sort.map(function (x) { return { key: x.key, dir: x.dir }; }),
        sortableColumns: aOpts,
        group: s.group || "",
        groupColumns: [{ key: "", text: b.getText("vsNone") }].concat(aOpts)
      });
      this._vsCount();
    },
    _vsCount: function () {
      var a = this._oVs.getProperty("/columns"), n = a.filter(function (c) { return c.selected; }).length;
      this._oVs.setProperty("/columnsTitle", this._oBundle.getText("vsColumnsCount", [n, a.length]));
      this._oVs.setProperty("/allSelected", n === a.length);
    },
    _vsFilter: function () {
      var oList = this.byId("vsColumns");
      if (!oList || !oList.getBinding("items")) { return; }
      var aF = [], q = this._oVs.getProperty("/search");
      if (q) { aF.push(new Filter("text", FilterOperator.Contains, q)); }
      if (this._oVs.getProperty("/hideUnselected")) { aF.push(new Filter("selected", FilterOperator.EQ, true)); }
      oList.getBinding("items").filter(aF);
    },
    onVsSearch: function (e) { this._oVs.setProperty("/search", e.getParameter("newValue")); this._vsFilter(); },
    onVsFilter: function () { this._vsFilter(); },
    onVsColumnSelect: function () { this._vsCount(); this._vsFilter(); },
    onVsSelectAll: function (e) {
      var bOn = e.getParameter("selected"), a = this._oVs.getProperty("/columns");
      a.forEach(function (c) { c.selected = bOn; });
      this._oVs.setProperty("/columns", a);
      this._vsCount(); this._vsFilter();
    },
    _vsMove: function (e, iDir) {
      var i = parseInt(e.getSource().getBindingContext("vs").getPath().split("/")[2], 10), a = this._oVs.getProperty("/columns"), j = i + iDir;
      while (j >= 0 && j < a.length && !a[j].selected) { j += iDir; }     // jump over unselected columns
      if (j < 0 || j >= a.length) { return; }
      var t = a[i]; a[i] = a[j]; a[j] = t;
      this._oVs.setProperty("/columns", a);
      this._vsFilter();
    },
    onVsMoveUp: function (e) { this._vsMove(e, -1); },
    onVsMoveDown: function (e) { this._vsMove(e, 1); },
    onVsAddSort: function () {
      var a = this._oVs.getProperty("/sort");
      a.push({ key: "", dir: "asc" });
      this._oVs.setProperty("/sort", a);
    },
    onVsRemoveSort: function (e) {
      var i = parseInt(e.getSource().getBindingContext("vs").getPath().split("/")[2], 10), a = this._oVs.getProperty("/sort");
      a.splice(i, 1);
      this._oVs.setProperty("/sort", a);
    },
    onVsReset: function () { this._vsLoad(this._defaultState().tbl); this._vsFilter(); },
    onVsCancel: function () { this._fragment("ViewSettings").then(function (d) { d.close(); }); },
    onVsOk: function () {
      var d = this._oVs.getData();
      var aCols = d.columns.filter(function (c) { return c.selected; }).map(function (c) { return c.key; });
      if (!aCols.length) { MessageToast.show(this._oBundle.getText("vsMinOneColumn")); return; }
      this.getView().getModel("view").setProperty("/tbl", {
        columns: aCols,
        sort: d.sort.filter(function (x) { return x.key; }).map(function (x) { return { key: x.key, dir: x.dir }; }),
        group: d.group || ""
      });
      this.onVsCancel();
      this._buildTable();
      this._checkModified();
    },


    // ------------------------------------------------------------ list: row details (show more / less per row)
    /** "Less": columns that do not fit are hidden (Low and Medium). "More": they are shown as details below the row. */
    _applyRowDetails: function () {
      var bMore = this.getView().getModel("view").getProperty("/rowDetails") === "more";
      this.byId("orderTable").setHiddenInPopin(bMore ? [] : ["Low", "Medium"]);
    },
    onRowDetailsChange: function () { this._applyRowDetails(); },

    // ------------------------------------------------------------ list: export (Excel / CSV)
    onExport: function () { this._export(this._oBundle.getText("exportFileName"), "xlsx"); },
    onExportAs: function () {
      this._oEx.setData({ name: this._oBundle.getText("exportFileName"), format: "xlsx",
                          info: this._oBundle.getText("exportRows", [this.getView().getModel("view").getProperty("/counts/list")]) });
      this._fragment("ExportAs").then(function (oDialog) { oDialog.open(); });
    },
    onExAsConfirm: function () {
      var d = this._oEx.getData();
      this.onExAsCancel();
      this._export((d.name || "").trim() || this._oBundle.getText("exportFileName"), d.format);
    },
    onExAsCancel: function () { this._fragment("ExportAs").then(function (oDialog) { oDialog.close(); }); },

    /** Exports the rows exactly as shown (current filters and sorting) with the visible columns. */
    _export: function (sName, sFormat) {
      var b = this._oBundle, oView = this.getView(), oBinding = this.byId("orderTable").getBinding("items");
      var aKeys = oView.getModel("view").getProperty("/tbl/columns").filter(function (k) { return COLS.byKey[k]; });
      var aRows = oBinding.getAllCurrentContexts().map(function (c) { return c.getObject(); });
      var aCols = [];
      aKeys.forEach(function (k) {
        var d = COLS.byKey[k];
        if (d.date) {
          aCols.push({ label: b.getText(d.label), property: "_x_" + k, type: "Date", utc: true, width: 14 });
        } else {
          aCols.push({ label: b.getText(d.label), property: d.field, type: "String", width: d.type === "text" && k === "desc" ? 40 : 18 });
          if (d.sub) { aCols.push({ label: b.getText(d.label) + " " + b.getText("exportNameSuffix"), property: d.sub, type: "String", width: 30 }); }
        }
      });
      var aData = aRows.map(function (o) {
        var r = Object.assign({}, o);
        aKeys.forEach(function (k) { var d = COLS.byKey[k]; if (d.date) { r["_x_" + k] = U.parse(o[d.sortField]); } });
        return r;
      });
      oView.setBusy(true);
      return new Promise(function (resolve, reject) {
        if (sFormat === "csv") { this._exportCsv(aCols, aData, sName).then(resolve, reject); return; }
        sap.ui.require(["sap/ui/core/Lib"], function (Lib) {
          Lib.load({ name: "sap.ui.export" }).then(function () {
            sap.ui.require(["sap/ui/export/Spreadsheet"], function (Spreadsheet) {
              var oSheet = new Spreadsheet({ workbook: { columns: aCols, context: { sheetName: b.getText("tableTitle") } },
                                             dataSource: aData, fileName: sName + ".xlsx", worker: false });
              oSheet.build().then(resolve, reject).finally(function () { oSheet.destroy(); });
            }, reject);
          }, reject);
        }, reject);
      }.bind(this)).then(function () {
        MessageToast.show(b.getText("exportDone", [sName + "." + sFormat]));
      }).catch(function (e) {
        MessageBox.error(b.getText("exportFailed", [e && e.message || e]));
      }).finally(function () { oView.setBusy(false); });
    },

    /** CSV: UTF-8 with byte order mark so Excel reads umlauts correctly; dates as ISO yyyy-mm-dd. */
    _exportCsv: function (aCols, aData, sName) {
      function cell(v) {
        if (v instanceof Date) { v = v.toISOString().substring(0, 10); }
        v = v == null ? "" : String(v);
        return /[",;\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }
      var aLines = [aCols.map(function (c) { return cell(c.label); }).join(",")];
      aData.forEach(function (r) { aLines.push(aCols.map(function (c) { return cell(r[c.property]); }).join(",")); });
      return new Promise(function (resolve) {
        sap.ui.require(["sap/ui/core/util/File"], function (File) {
          File.save(aLines.join("\r\n"), sName, "csv", "text/csv", "utf-8", true);
          resolve();
        });
      });
    },

    // ------------------------------------------------------------ saved views (variants): filters + list settings + schedule + card layout
    _defaultState: function () {
      return { filters: DEFAULT_FILTERS(),
               tbl: { columns: COLS.defaults.slice(), sort: [{ key: "planStart", dir: "asc" }], group: "" },
               schedule: { rowsBy: "FunctionalLocation", granularity: "month" },
               cardLayout: "compact" };
    },
    _captureState: function () {
      var oM = this.getView().getModel("view"), f = oM.getProperty("/filters");
      return JSON.parse(JSON.stringify({
        filters: { plants: f.plants, plannerGroups: f.plannerGroups, workCenters: f.workCenters, statuses: f.statuses, search: f.search, hideClosed: f.hideClosed },
        tbl: { columns: oM.getProperty("/tbl/columns"), sort: oM.getProperty("/tbl/sort"), group: oM.getProperty("/tbl/group") },
        schedule: { rowsBy: oM.getProperty("/schedule/rowsBy"), granularity: oM.getProperty("/schedule/granularity") },
        cardLayout: oM.getProperty("/cardLayout")
      }));
    },
    _applyState: function (st) {
      var oM = this.getView().getModel("view");
      oM.setProperty("/filters", JSON.parse(JSON.stringify(st.filters)));
      oM.setProperty("/tbl", JSON.parse(JSON.stringify(st.tbl)));
      oM.setProperty("/schedule/rowsBy", st.schedule.rowsBy);
      oM.setProperty("/schedule/granularity", st.schedule.granularity);
      oM.setProperty("/cardLayout", st.cardLayout);
      this._buildTable();
      this._refresh();
    },
    _allVariants: function () {
      return [{ id: "__standard", name: this._oBundle.getText("variantStandard"), readOnly: true, state: this._defaultState() }]
        .concat(this._store.items);
    },
    _currentVariant: function () {
      var sId = this.getView().getModel("view").getProperty("/variants/currentId");
      return this._allVariants().find(function (v) { return v.id === sId; });
    },
    _initVariants: function () {
      var aAll = this._allVariants(), v = aAll.find(function (x) { return x.id === this._store.defaultId; }, this) || aAll[0];
      this.getView().getModel("view").setProperty("/variants/currentId", v.id);
      this._applyState(v.state);
      this._refreshVariants();
    },
    _refreshVariants: function () {
      var oM = this.getView().getModel("view"), sCur = oM.getProperty("/variants/currentId"), b = this._oBundle, sDef = this._store.defaultId;
      oM.setProperty("/variants/list", this._allVariants().map(function (v) {
        return { id: v.id, name: v.name, info: v.id === sDef ? b.getText("variantDefault") : "", selected: v.id === sCur };
      }));
      this._checkModified();
    },
    /** The title shows "<view> *" as soon as filters or list settings differ from the selected view. */
    _checkModified: function () {
      var oM = this.getView().getModel("view"), v = this._currentVariant();
      if (!v) { return; }
      var bMod = JSON.stringify(this._captureState()) !== JSON.stringify(v.state);
      oM.setProperty("/variants/modified", bMod);
      oM.setProperty("/variants/title", v.name + (bMod ? " *" : ""));
      oM.setProperty("/variants/canSave", bMod && !v.readOnly);
    },
    _persist: function () { VariantStore.save(this._store); },
    _selectVariant: function (sId) {
      var v = this._allVariants().find(function (x) { return x.id === sId; }) || this._allVariants()[0];
      this.getView().getModel("view").setProperty("/variants/currentId", v.id);
      this._applyState(v.state);
      this._refreshVariants();
    },

    onVariantPress: function (e) {
      var oBtn = e.getSource();
      this._fragment("VariantPopover").then(function (oPop) { oPop.openBy(oBtn); });
    },
    onVariantSelect: function (e) {
      var sId = e.getParameter("listItem").getBindingContext("view").getObject().id;
      this._fragment("VariantPopover").then(function (oPop) { oPop.close(); });
      this._selectVariant(sId);
    },
    onVariantSave: function () {
      var v = this._currentVariant();
      if (!v || v.readOnly) { return; }
      v.state = this._captureState();         // v is the stored item itself
      this._persist();
      this._refreshVariants();
      this._fragment("VariantPopover").then(function (oPop) { oPop.close(); });
      MessageToast.show(this._oBundle.getText("variantSaved", [v.name]));
    },
    onVariantSaveAs: function () {
      this._oSa.setData({ name: "", isDefault: false });
      this._fragment("VariantPopover").then(function (oPop) { oPop.close(); });
      this._fragment("VariantSaveAs").then(function (oDialog) { oDialog.open(); });
    },
    onSaCancel: function () { this._fragment("VariantSaveAs").then(function (d) { d.close(); }); },
    onSaConfirm: function () {
      var d = this._oSa.getData(), sName = (d.name || "").trim();
      if (!sName) { return; }
      var oItem = { id: "v" + Date.now(), name: sName, state: this._captureState() };
      this._store.items.push(oItem);
      if (d.isDefault) { this._store.defaultId = oItem.id; }
      this._persist();
      this.getView().getModel("view").setProperty("/variants/currentId", oItem.id);
      this._refreshVariants();
      this.onSaCancel();
      MessageToast.show(this._oBundle.getText("variantSaved", [sName]));
    },
    onVariantManage: function () {
      var sDef = this._store.defaultId;
      this._oMg.setData({ list: this._allVariants().map(function (v) {
        return { id: v.id, name: v.name, readOnly: !!v.readOnly, isDefault: v.id === sDef };
      }) });
      this._fragment("VariantPopover").then(function (oPop) { oPop.close(); });
      this._fragment("VariantManage").then(function (oDialog) { oDialog.open(); });
    },
    onMgDefault: function (e) {
      var i = parseInt(e.getSource().getBindingContext("mg").getPath().split("/")[2], 10), a = this._oMg.getProperty("/list");
      a.forEach(function (x, k) { x.isDefault = k === i; });
      this._oMg.setProperty("/list", a);
    },
    onMgDelete: function (e) {
      var i = parseInt(e.getSource().getBindingContext("mg").getPath().split("/")[2], 10), a = this._oMg.getProperty("/list");
      var bWasDefault = a[i].isDefault;
      a.splice(i, 1);
      if (bWasDefault && a.length) { a[0].isDefault = true; }
      this._oMg.setProperty("/list", a);
    },
    onMgCancel: function () { this._fragment("VariantManage").then(function (d) { d.close(); }); },
    onMgOk: function () {
      var a = this._oMg.getProperty("/list"), oDef = a.find(function (x) { return x.isDefault; });
      this._store.items = this._store.items.filter(function (it) { return a.some(function (x) { return x.id === it.id; }); })
        .map(function (it) {
          var x = a.find(function (l) { return l.id === it.id; });
          it.name = (x.name || "").trim() || it.name;
          return it;
        });
      this._store.defaultId = oDef ? oDef.id : "__standard";
      this._persist();
      var sCur = this.getView().getModel("view").getProperty("/variants/currentId");
      if (this._allVariants().some(function (v) { return v.id === sCur; })) { this._refreshVariants(); } else { this._selectVariant("__standard"); }
      this.onMgCancel();
    },

    onCardLayoutChange: function () { this._checkModified(); },

    // ------------------------------------------------------------ events
    onFilterChange: function () { this._refresh(); },
    onClearFilters: function () {
      this.getView().getModel("view").setProperty("/filters", DEFAULT_FILTERS());
      this._refresh();
    },
    onTabSelect: function () { /* data is shared between the views */ },
    onRefresh: function () { this._load(); },

    onOpenOrder: function (oEvent) {
      var o = oEvent.getSource().getBindingContext("view").getObject();
      this._open("order", o.MaintenanceOrder, o.OrderText);
    },
    onOpenNotification: function (oEvent) {
      var o = oEvent.getSource().getBindingContext("view").getObject();
      this._open("notification", o.MaintenanceNotification, o.NotificationText);
    },
    _open: function (sKind, sId, sText) {
      this._oData.navigate(sKind, sId).then(function (bOk) {
        if (!bOk) { MessageToast.show(this._oBundle.getText("navUnavailable", [sText])); }
      }.bind(this)).catch(function (e) { MessageBox.error(String(e && e.message || e)); });
    }
  });
});
