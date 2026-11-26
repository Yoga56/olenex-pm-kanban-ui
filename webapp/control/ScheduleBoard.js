sap.ui.define(["sap/ui/core/Control", "sap/ui/core/IconPool"], function (Control, IconPool) {
  "use strict";

  /**
   * Plan-per-object matrix (rows = functional location / equipment / work center, columns = periods).
   * Every order is a bar from its plan start to its plan end; a bar can be dragged to another period of the same row (it keeps its length).
   * Keyboard / pointer alternative: Enter, Space or click on a chip fires "orderPress" (the app opens a dialog
   * where the plan start date can be changed) - drag and drop is never the only way.
   *
   *  periods: [{label, sublabel, current}]
   *  rows:    [{key, title, subtitle, unscheduled:[chip], cells:[[chip]]}]
   *  chip:    {id, text, tooltip, state: "Success"|"Information"|"Error", stateText, draggable}
   */
  var ICON = { Success: "sap-icon://accept", Information: "sap-icon://appointment-2", Error: "sap-icon://alert" };
  var EDGE = 48, STEP = 24;   // auto-scroll while dragging near the edge of the board

  return Control.extend("zpm.kanban.control.ScheduleBoard", {
    metadata: {
      properties: {
        periods: { type: "object[]", defaultValue: [] },
        rows: { type: "object[]", defaultValue: [] },
        unscheduledText: { type: "string", defaultValue: "Unscheduled" },
        ariaLabel: { type: "string", defaultValue: "" }
      },
      events: {
        reschedule: { parameters: { orderId: "string", periodIndex: "int" } },
        orderPress: { parameters: { orderId: "string" } }
      }
    },

    renderer: {
      apiVersion: 2,
      render: function (rm, oCtl) {
        var aPeriods = oCtl.getPeriods(), aRows = oCtl.getRows(), nP = aPeriods.length;

        // one bar per order: from the period of its plan start to the period of its plan end (CSS grid: columns = periods, rows = lanes)
        function bar(c, sRow, iCol, iColEnd, iRow) {
          rm.openStart("div").class("pmBar").class("pmBar" + c.state)
            .attr("role", "button").attr("tabindex", "0")
            .attr("data-id", c.id).attr("data-row", sRow)
            .attr("aria-label", c.tooltip.replace(/\n/g, ", "))
            .attr("title", c.tooltip)
            .style("grid-column", iCol + " / " + iColEnd).style("grid-row", String(iRow));
          if (iCol === 2) { rm.class("pmBarUnsched"); }
          if (c.clipL) { rm.class("pmBarClipL"); }
          if (c.clipR) { rm.class("pmBarClipR"); }
          if (c.draggable) { rm.attr("draggable", "true").attr("aria-grabbed", "false"); }
          rm.openEnd();
          rm.openStart("span").class("pmBarTop").openEnd();
          rm.icon(ICON[c.state], ["pmBarIcon"], { "aria-hidden": "true" });
          rm.openStart("b").class("pmBarNum").openEnd().text(c.num).close("b");
          rm.close("span");
          rm.openStart("span").class("pmBarDesc").openEnd().text(c.desc).close("span");
          if (c.dateText) { rm.openStart("span").class("pmBarDate").openEnd().text(c.dateText).close("span"); }
          rm.close("div");
        }

        rm.openStart("div", oCtl).class("pmBoard").attr("role", "region").attr("aria-label", oCtl.getAriaLabel()).openEnd();
        rm.openStart("div").class("pmGrid")
          .style("grid-template-columns", "11rem 8rem repeat(" + nP + ", minmax(6.5rem, 1fr))")
          .style("min-width", (11 + 8 + nP * 6.5) + "rem").openEnd();

        rm.openStart("div").class("pmHead").class("pmCorner").style("grid-area", "1 / 1").openEnd().close("div");
        rm.openStart("div").class("pmHead").class("pmHeadUnsched").style("grid-area", "1 / 2").openEnd().text(oCtl.getUnscheduledText()).close("div");
        aPeriods.forEach(function (p, i) {
          rm.openStart("div").class("pmHead").style("grid-area", "1 / " + (i + 3));
          if (p.title) { rm.attr("title", p.title); }
          if (p.current) { rm.class("pmCurrent").attr("aria-current", "date"); }
          rm.openEnd().text(p.label);
          if (p.sublabel) { rm.openStart("div").class("pmSub").openEnd().text(p.sublabel).close("div"); }
          rm.close("div");
        });

        var iRow = 2;
        aRows.forEach(function (r) {
          var L = r.lanes || 1, sSpan = iRow + " / span " + L;
          rm.openStart("div").class("pmRowHead").attr("role", "rowheader").style("grid-row", sSpan).style("grid-column", "1").openEnd();
          rm.openStart("span").class("pmRowTitle").openEnd().text(r.title).close("span");
          if (r.subtitle) { rm.openStart("small").openEnd().text(r.subtitle).close("small"); }
          rm.close("div");

          rm.openStart("div").class("pmCell").class("pmCellUnsched").attr("data-row", r.key).attr("data-p", "-1")
            .style("grid-row", sSpan).style("grid-column", "2").openEnd().close("div");
          aPeriods.forEach(function (p, i) {
            rm.openStart("div").class("pmCell").attr("data-row", r.key).attr("data-p", String(i))
              .style("grid-row", sSpan).style("grid-column", String(i + 3));
            if (p.current) { rm.class("pmCurrent"); }
            rm.openEnd().close("div");
          });

          (r.unscheduled || []).forEach(function (c, k) { bar(c, r.key, 2, 3, iRow + k); });
          (r.bars || []).forEach(function (c) { bar(c, r.key, c.from + 3, c.to + 4, iRow + c.lane); });
          iRow += L;
        });
        rm.close("div").close("div");
      }
    },

    onAfterRendering: function () {
      var el = this.getDomRef(), that = this;
      if (!el || el.__pmBound) { return; }      // DOM root is patched, not replaced -> bind once
      el.__pmBound = true;

      function cellOf(e, sRow) {
        var a = document.elementsFromPoint(e.clientX, e.clientY);
        for (var i = 0; i < a.length; i++) {
          if (a[i].classList && a[i].classList.contains("pmCell") && el.contains(a[i]) && a[i].dataset.row === sRow) { return a[i]; }
        }
        return null;
      }
      function clear() {
        el.querySelectorAll(".pmOver").forEach(function (n) { n.classList.remove("pmOver"); });
        el.querySelectorAll(".pmDragging").forEach(function (n) { n.classList.remove("pmDragging"); n.setAttribute("aria-grabbed", "false"); });
      }
      function autoScroll(e) {
        var r = el.getBoundingClientRect();
        if (e.clientX > r.right - EDGE) { el.scrollLeft += STEP; } else if (e.clientX < r.left + EDGE + 240) { el.scrollLeft -= STEP; }
        if (e.clientY > r.bottom - EDGE) { el.scrollTop += STEP; } else if (e.clientY < r.top + EDGE) { el.scrollTop -= STEP; }
      }

      el.addEventListener("dragstart", function (e) {
        var c = e.target.closest && e.target.closest(".pmBar");
        if (!c || c.getAttribute("draggable") !== "true") { return; }
        that._drag = { id: c.dataset.id, row: c.dataset.row };
        e.dataTransfer.setData("text/plain", c.dataset.id);
        e.dataTransfer.effectAllowed = "move";
        c.classList.add("pmDragging");
        c.setAttribute("aria-grabbed", "true");
      });
      el.addEventListener("dragend", function () { that._drag = null; clear(); });
      el.addEventListener("dragover", function (e) {
        if (!that._drag) { return; }
        autoScroll(e);
        var cell = cellOf(e, that._drag.row);
        if (cell && cell.dataset.p !== "-1") {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (!cell.classList.contains("pmOver")) {
            el.querySelectorAll(".pmOver").forEach(function (n) { n.classList.remove("pmOver"); });
            cell.classList.add("pmOver");
          }
        }
      });
      el.addEventListener("drop", function (e) {
        var cell = that._drag && cellOf(e, that._drag.row);
        if (!that._drag || !cell || cell.dataset.p === "-1") { return; }
        e.preventDefault();
        var id = that._drag.id;
        that._drag = null;
        clear();
        that.fireReschedule({ orderId: id, periodIndex: parseInt(cell.dataset.p, 10) });
      });
      el.addEventListener("click", function (e) {
        var c = e.target.closest && e.target.closest(".pmBar");
        if (c) { that.fireOrderPress({ orderId: c.dataset.id }); }
      });
      el.addEventListener("keydown", function (e) {
        var c = e.target.closest && e.target.closest(".pmBar");
        if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); that.fireOrderPress({ orderId: c.dataset.id }); }
      });
    }
  });
});
