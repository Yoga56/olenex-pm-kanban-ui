sap.ui.define([], function () {
  "use strict";
  /**
   * Columns of the list. key = column id, label = i18n key of the header,
   * field = displayed (formatted) value, sortField = raw value used for sort/group.
   * importance: High columns stay visible, Low columns are hidden first when the table gets narrow.
   */
  var COLUMNS = [
    { key: "order",        label: "colOrder",        field: "OrderText",                sortField: "MaintenanceOrder",       width: "7rem",  importance: "High",   type: "order" },
    { key: "desc",         label: "colDescription",  field: "MaintenanceOrderDesc",                                         width: "13rem", importance: "High",   type: "text" },
    { key: "plannerGroup", label: "colPlannerGroup", field: "MaintenancePlannerGroup",                                      width: "5.5rem",  importance: "Low",    type: "text" },
    { key: "workCenter",   label: "colWorkCenter",   field: "MainWorkCenter",                                               width: "6.5rem",  importance: "Low",    type: "text" },
    { key: "funcLoc",      label: "colFuncLoc",      field: "FunctionalLocation", sub: "FunctionalLocationName",           width: "11rem", importance: "Medium", type: "two" },
    { key: "equipment",    label: "colEquipment",    field: "EquipmentText",      sub: "EquipmentName", sortField: "Equipment", width: "9rem", importance: "Medium", type: "two" },
    { key: "planStart",    label: "colPlanStart",    field: "StartDateText",            sortField: "MaintOrdBasicStartDate", width: "7.5rem",  importance: "High",   type: "planStart", date: true },
    { key: "created",      label: "colOrderCreated", field: "CreatedText",              sortField: "OrderCreationDate",      width: "7rem",  importance: "Low",    type: "text", date: true },
    { key: "status",       label: "colOrderStatus",  field: "StatusText",               sortField: "KanbanStatus",           width: "9rem", importance: "High",   type: "status" },
    { key: "reportDate",   label: "colReportDate",   field: "ReportDateText",           sortField: "NotificationReportDate", width: "7rem",  importance: "Low",    type: "text", date: true },
    { key: "notification", label: "colNotification", field: "NotificationText",         sortField: "MaintenanceNotification", width: "7.5rem", importance: "Medium", type: "notification" },
    { key: "notifCreated", label: "colNotifCreated", field: "NotifCreatedText",         sortField: "NotificationCreatedOn", width: "7rem",  importance: "Low",    type: "text", date: true },
    // optional columns, not shown by default
    { key: "plant",        label: "colPlant",        field: "MaintenancePlanningPlant",                                     width: "5rem",  importance: "Low",    type: "text" },
    { key: "planEnd",      label: "colPlanEnd",      field: "EndDateText",              sortField: "MaintOrdBasicEndDate",   width: "7rem",  importance: "Low",    type: "text", date: true },
    { key: "orderType",    label: "colOrderType",    field: "MaintenanceOrderType",                                         width: "6rem",  importance: "Low",    type: "text" },
    { key: "priority",     label: "colPriority",     field: "MaintPriority",                                                width: "5rem",  importance: "Low",    type: "text" }
  ];
  // default = the columns requested for report 1, in the requested order
  var DEFAULT = ["order", "desc", "plannerGroup", "workCenter", "funcLoc", "equipment", "planStart", "created",
                 "status", "reportDate", "notification", "notifCreated"];
  var BY_KEY = {};
  COLUMNS.forEach(function (c) { BY_KEY[c.key] = c; });
  return { all: COLUMNS, byKey: BY_KEY, defaults: DEFAULT };
});
