/*
 * Copyright (c) 2017 VMware Inc. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {drag as d3drag} from "d3-drag";
import {interpolateRainbow as d3interpolateRainbow} from "d3-scale-chromatic";
import {event as d3event, mouse as d3mouse} from "d3-selection";
import {DatasetView, Histogram2DSerialization, IViewSerialization} from "../datasetView";
import {DistinctStrings} from "../distinctStrings";
import {
    BasicColStats, CategoricalValues, ColumnAndRange, CombineOperators,
    FilterDescription, HeatMap, Histogram, Histogram2DArgs,
    IColumnDescription, RecordOrder, RemoteObjectId,
} from "../javaBridge";
import {Receiver, RpcRequest} from "../rpc";
import {SchemaClass} from "../schemaClass";
import {BaseRenderer, TableTargetAPI, ZipReceiver} from "../tableTarget";
import {CDFPlot} from "../ui/CDFPlot";
import {IDataView} from "../ui/dataview";
import {Dialog} from "../ui/dialog";
import {FullPage} from "../ui/fullPage";
import {Histogram2DPlot} from "../ui/Histogram2DPlot";
import {HistogramLegendPlot} from "../ui/legendPlot";
import {SubMenu, TopMenu} from "../ui/menu";
import {PlottingSurface} from "../ui/plottingSurface";
import {TextOverlay} from "../ui/textOverlay";
import {Rectangle, Resolution} from "../ui/ui";
import {
    formatNumber, ICancellable, Pair, PartialResult, percent,
    reorder, saveAs, Seed, significantDigits,
} from "../util";
import {AnyScale, AxisData} from "./axisData";
import {Range2DCollector} from "./heatmapView";
import { BucketDialog, HistogramViewBase } from "./histogramViewBase";
import {NextKReceiver, TableView} from "./tableView";
import {ChartObserver} from "./tsViewBase";

/**
 * This class is responsible for rendering a 2D histogram.
 * This is a histogram where each bar is divided further into sub-bars.
 */
export class Histogram2DView extends HistogramViewBase {
    protected currentData: {
        xData: AxisData;
        yData: AxisData;
        cdf: Histogram;
        heatMap: HeatMap;
        xPoints: number;
        yPoints: number;
        samplingRate: number;
    };
    protected relative: boolean;  // true when bars are normalized to 100%
    protected legendRect: Rectangle;  // legend position on the screen; relative to canvas
    protected menu: TopMenu;
    protected legendSelectionRectangle: any;
    protected plot: Histogram2DPlot;
    protected legendPlot: HistogramLegendPlot;
    protected legendSurface: PlottingSurface;
    protected samplingRate: number;

    constructor(remoteObjectId: RemoteObjectId, rowCount: number,
                schema: SchemaClass, page: FullPage) {
        super(remoteObjectId, rowCount, schema, page, "2DHistogram");

        this.legendSurface = new PlottingSurface(this.chartDiv, page);
        this.legendSurface.setHeight(Resolution.legendSpaceHeight);
        this.legendPlot = new HistogramLegendPlot(this.legendSurface);
        this.surface = new PlottingSurface(this.chartDiv, page);
        this.plot = new Histogram2DPlot(this.surface);
        this.cdfPlot = new CDFPlot(this.surface);

        this.menu = new TopMenu( [{
           text: "Export",
           help: "Save the information in this view in a local file.",
           subMenu: new SubMenu([{
               text: "As CSV",
               help: "Saves the data in this view in a CSV file.",
               action: () => { this.export(); },
           }]),
        }, {
            text: "View",
            help: "Change the way the data is displayed.",
            subMenu: new SubMenu([{
                text: "refresh",
                action: () => { this.refresh(); },
                help: "Redraw this view",
            }, {
                text: "table",
                action: () => this.showTable(),
                help: "Show the data underlying this plot in a tabular view. ",
            }, {
                text: "exact",
                action: () => { this.exactHistogram(); },
                help: "Draw this histogram without approximations.",
            }, {
                text: "# buckets...",
                action: () => this.chooseBuckets(),
                help: "Change the number of buckets used for drawing the histogram." +
                    "The number must be between 1 and " + Resolution.maxBucketCount,
            }, {
                text: "swap axes",
                action: () => { this.swapAxes(); },
                help: "Redraw this histogram by swapping the X and Y axes.",
            }, {
                text: "heatmap",
                action: () => { this.heatmap(); },
                help: "Plot this data as a heatmap view.",
            }, {
                text: "relative/absolute",
                action: () => this.toggleNormalize(),
                help: "In an absolute plot the Y axis represents the size for a bucket. " +
                "In a relative plot all bars are normalized to 100% on the Y axis.",
            }]) },
            page.dataset.combineMenu(this, page.pageId),
        ]);

        this.relative = false;
        this.page.setMenu(this.menu);
    }

    public updateView(heatmap: HeatMap, xData: AxisData, yData: AxisData, cdf: Histogram,
                      samplingRate: number, relative: boolean, elapsedMs: number): void {
        this.relative = relative;
        this.samplingRate = samplingRate;
        this.page.reportTime(elapsedMs);
        this.plot.clear();
        this.legendPlot.clear();
        if (heatmap == null || heatmap.buckets.length === 0) {
            this.page.reportError("No data to display");
            return;
        }
        if (samplingRate >= 1) {
            const submenu = this.menu.getSubmenu("View");
            submenu.enable("exact", false);
        }
        const xPoints = heatmap.buckets.length;
        const yPoints = heatmap.buckets[0].length;
        if (yPoints === 0) {
            this.page.reportError("No data to display");
            return;
        }
        this.currentData = {
            heatMap: heatmap,
            xData,
            yData,
            cdf,
            samplingRate,
            xPoints,
            yPoints,
        };

        const bucketCount = xPoints;
        const canvas = this.surface.getCanvas();

        const legendDrag = d3drag()
            .on("start", () => this.dragLegendStart())
            .on("drag", () => this.dragLegendMove())
            .on("end", () => this.dragLegendEnd());
        this.legendSurface.getCanvas()
            .call(legendDrag);

        const drag = d3drag()
            .on("start", () => this.dragStart())
            .on("drag", () => this.dragMove())
            .on("end", () => this.dragCanvasEnd());

        this.plot.setData(heatmap, cdf, xData, yData, samplingRate, this.relative);
        this.plot.draw();
        this.cdfPlot.setData(cdf);
        this.cdfPlot.draw();
        this.legendPlot.setData(yData, this.plot.getMissingDisplayed() > 0);
        this.legendPlot.draw();

        canvas.call(drag)
            .on("mousemove", () => this.mouseMove())
            .on("mouseleave", () => this.mouseLeave())
            .on("mouseenter", () => this.mouseEnter());

        this.cdfDot = canvas
            .append("circle")
            .attr("r", Resolution.mouseDotRadius)
            .attr("fill", "blue");

        this.legendRect = this.legendPlot.legendRectangle();

        this.selectionRectangle = canvas
            .append("rect")
            .attr("class", "dashed")
            .attr("width", 0)
            .attr("height", 0);
        this.legendSelectionRectangle = this.legendSurface.getCanvas()
            .append("rect")
            .attr("class", "dashed")
            .attr("width", 0)
            .attr("height", 0);

        this.pointDescription = new TextOverlay(this.surface.getChart(),
            this.surface.getDefaultChartSize(),
            [   this.currentData.xData.description.name,
                this.currentData.yData.description.name,
                "y", "count", "%", "cdf"], 40);
        this.pointDescription.show(false);
        let summary = formatNumber(this.plot.getDisplayedPoints()) + " data points";
        if (heatmap.missingData !== 0)
            summary += ", " + formatNumber(heatmap.missingData) + " missing both coordinates";
        if (heatmap.histogramMissingX.missingData !== 0)
            summary += ", " + formatNumber(heatmap.histogramMissingX.missingData) + " missing Y coordinate";
        if (heatmap.histogramMissingY.missingData !== 0)
            summary += ", " + formatNumber(heatmap.histogramMissingY.missingData) + " missing X coordinate";
        summary += ", " + String(bucketCount) + " buckets";
        if (samplingRate < 1.0)
            summary += ", sampling rate " + significantDigits(samplingRate);
        this.summary.innerHTML = summary;
    }

    public serialize(): IViewSerialization {
        const result: Histogram2DSerialization = {
            ...super.serialize(),
            exact: this.currentData.samplingRate >= 1,
            relative: this.relative,
            columnDescription0: this.currentData.xData.description,
            columnDescription1: this.currentData.yData.description,
        };
        return result;
    }

    public static reconstruct(ser: Histogram2DSerialization, page: FullPage): IDataView {
        const exact: boolean = ser.exact;
        const relative: boolean = ser.relative;
        const cd0: IColumnDescription = ser.columnDescription0;
        const cd1: IColumnDescription = ser.columnDescription1;
        const schema: SchemaClass = new SchemaClass([]).deserialize(ser.schema);
        if (cd0 == null || cd1 == null || exact == null || schema == null)
            return null;
        const cds = [cd0, cd1];

        const hv = new Histogram2DView(ser.remoteObjectId, ser.rowCount, schema, page);
        const rr = page.dataset.createGetCategoryRequest(page, cds);
        rr.invoke(new ChartObserver(hv, page, rr, null,
            ser.rowCount, schema,
            { exact, heatmap: false, relative, reusePage: true }, cds));
        return hv;
    }

    public toggleNormalize(): void {
        this.relative = !this.relative;
        if (this.relative && this.samplingRate < 1) {
            // We cannot use sampling when we display relative views.
            this.exactHistogram();
        } else {
            this.refresh();
        }
    }

    public heatmap(): void {
        const rcol = new Range2DCollector(
            [this.currentData.xData.description, this.currentData.yData.description],
            this.rowCount, this.schema,
            [this.currentData.xData.distinctStrings, this.currentData.yData.distinctStrings],
            this.page, this, this.currentData.samplingRate >= 1, null, true, false, false);
        rcol.setValue({ first: this.currentData.xData.stats, second: this.currentData.yData.stats });
        rcol.onCompleted();
    }

    public export(): void {
        const lines: string[] = this.asCSV();
        const fileName = "histogram2d.csv";
        saveAs(fileName, lines.join("\n"));
        this.page.reportError("Check the downloads folder for a file named '" + fileName + "'");
    }

    /**
     * Convert the data to text.
     * @returns {string[]}  An array of lines describing the data.
     */
    public asCSV(): string[] {
        const lines: string[] = [];
        let line = "";
        for (let y = 0; y < this.currentData.yData.bucketCount; y++) {
            const by = this.currentData.yData.bucketDescription(y);
            line += "," + JSON.stringify(this.currentData.yData.description.name + " " + by);
        }
        line += ",missing";
        lines.push(line);
        for (let x = 0; x < this.currentData.xData.bucketCount; x++) {
            const data = this.currentData.heatMap.buckets[x];
            const bx = this.currentData.xData.bucketDescription(x);
            let l = JSON.stringify(this.currentData.xData.description.name + " " + bx);
            for (const y of data)
                l += "," + y;
            l += "," + this.currentData.heatMap.histogramMissingY.buckets[x];
            lines.push(l);
        }
        line = "mising";
        for (const y of this.currentData.heatMap.histogramMissingX.buckets)
            line += "," + y;
        lines.push(line);
        return lines;
    }

    // combine two views according to some operation
    public combine(how: CombineOperators): void {
        const r = this.dataset.getSelected();
        if (r.first == null)
            return;

        const rr = this.createZipRequest(r.first);
        const renderer = (page: FullPage, operation: ICancellable) => {
            return new Make2DHistogram(
                page, operation,
                [this.currentData.xData.description, this.currentData.yData.description],
                [this.currentData.xData.distinctStrings, this.currentData.yData.distinctStrings],
                this.rowCount, this.schema, this.currentData.samplingRate >= 1, false, this.dataset,
                this.relative);
        };
        rr.invoke(new ZipReceiver(this.getPage(), rr, how, this.dataset, renderer));
    }

    public swapAxes(): void {
        if (this.currentData == null)
            return;
        const rc = new Range2DCollector(
            [this.currentData.yData.description, this.currentData.xData.description],
            this.rowCount, this.schema,
            [this.currentData.yData.distinctStrings, this.currentData.xData.distinctStrings],
            this.page, this, true, null, false, this.relative, false);
        rc.setValue({ first: this.currentData.yData.stats, second: this.currentData.xData.stats });
        rc.onCompleted();
    }

    public exactHistogram(): void {
        if (this.currentData == null)
            return;
        const rc = new Range2DCollector(
            [this.currentData.xData.description, this.currentData.yData.description],
            this.rowCount, this.schema,
            [this.currentData.xData.distinctStrings, this.currentData.yData.distinctStrings],
            this.page, this, true, null, false, this.relative, true);
        rc.setValue({ first: this.currentData.xData.stats,
            second: this.currentData.yData.stats });
        rc.onCompleted();
    }

    public changeBuckets(bucketCount: number): void {
        const samplingRate = HistogramViewBase.samplingRate(bucketCount,
            this.currentData.xData.stats.presentCount, this.page);

        let xBoundaries;
        let yBoundaries;
        if (this.currentData.xData.distinctStrings == null)
            xBoundaries = null;
        else
            xBoundaries = this.currentData.xData.distinctStrings.uniqueStrings;
        if (this.currentData.yData.distinctStrings == null)
            yBoundaries = null;
        else
            yBoundaries = this.currentData.yData.distinctStrings.uniqueStrings;

        const arg0: ColumnAndRange = {
            columnName: this.currentData.xData.description.name,
            min: this.currentData.xData.stats.min,
            max: this.currentData.xData.stats.max,
            bucketBoundaries: xBoundaries,
        };
        const arg1: ColumnAndRange = {
            columnName: this.currentData.yData.description.name,
            min: this.currentData.yData.stats.min,
            max: this.currentData.yData.stats.max,
            bucketBoundaries: yBoundaries,
        };
        const size = PlottingSurface.getDefaultChartSize(this.page);
        const cdfCount = Math.floor(size.width);

        const args: Histogram2DArgs = {
            first: arg0,
            second: arg1,
            xBucketCount: bucketCount,
            yBucketCount: this.currentData.yPoints,
            samplingRate,
            seed: Seed.instance.get(),
            cdfBucketCount: cdfCount,
            cdfSamplingRate: HistogramViewBase.samplingRate(bucketCount,
                this.currentData.xData.stats.presentCount, this.page),
        };
        const rr = this.createHistogram2DRequest(args);
        const renderer = new Histogram2DRenderer(this.page,
            this, this.rowCount, this.schema,
            [this.currentData.xData.description, this.currentData.yData.description],
            [this.currentData.xData.stats, this.currentData.yData.stats],
            samplingRate,
            [this.currentData.xData.distinctStrings, this.currentData.yData.distinctStrings],
            rr, this.relative, true);
        rr.invoke(renderer);
    }

    public chooseBuckets(): void {
        if (this.currentData == null)
            return;

        const bucketDialog = new BucketDialog();
        bucketDialog.setAction(() => this.changeBuckets(bucketDialog.getBucketCount()));
        bucketDialog.show();
    }

    public refresh(): void {
        if (this.currentData == null)
            return;
        this.updateView(
            this.currentData.heatMap,
            this.currentData.xData,
            this.currentData.yData,
            this.currentData.cdf,
            this.currentData.samplingRate,
            this.relative,
            0);
        this.page.scrollIntoView();
    }

    public mouseEnter(): void {
        super.mouseEnter();
        this.cdfDot.attr("visibility", "visible");
    }

    public mouseLeave(): void {
        this.cdfDot.attr("visibility", "hidden");
        super.mouseLeave();
    }

    /**
     * Handles mouse movements in the canvas area only.
     */
    public mouseMove(): void {
        const position = d3mouse(this.surface.getChart().node());
        // note: this position is within the chart
        const mouseX = position[0];
        const mouseY = position[1];

        const xs = HistogramViewBase.invert(position[0], this.plot.xScale,
            this.currentData.xData.description.kind, this.currentData.xData.distinctStrings);
        const y = Math.round(this.plot.yScale.invert(mouseY));
        let ys = significantDigits(y);
        let scale = 1.0;
        if (this.relative)
            ys += "%";

        // Find out the rectangle where the mouse is
        let value = "";
        let size = "";
        const xIndex = Math.floor(mouseX / this.plot.getBarWidth());
        let perc: number = 0;
        let colorIndex: number = null;
        let found = false;
        if (xIndex >= 0 && xIndex < this.currentData.heatMap.buckets.length &&
            y >= 0 && mouseY < this.surface.getActualChartHeight()) {
            const values: number[] = this.currentData.heatMap.buckets[xIndex];

            let total = 0;
            for (const v of values)
                total += v;
            total += this.currentData.heatMap.histogramMissingY.buckets[xIndex];
            if (total > 0) {
                // There could be no data for this specific x value
                if (this.relative)
                    scale = 100 / total;

                let yTotalScaled = 0;
                let yTotal = 0;
                for (let i = 0; i < values.length; i++) {
                    yTotalScaled += values[i] * scale;
                    yTotal += values[i];
                    if (yTotalScaled >= y && !found) {
                        size = significantDigits(values[i]);
                        perc = values[i];
                        value = this.currentData.yData.bucketDescription(i);
                        colorIndex = i;
                        found = true;
                    }
                }
                const missing = this.currentData.heatMap.histogramMissingY.buckets[xIndex];
                yTotal += missing;
                yTotalScaled += missing * scale;
                if (!found && yTotalScaled >= y) {
                    value = "missing";
                    size = significantDigits(missing);
                    perc = missing;
                    colorIndex = -1;
                }
                if (yTotal > 0)
                    perc = perc / yTotal;
            }
            // else value is ""
        }

        const pos = this.cdfPlot.getY(mouseX);
        this.cdfDot.attr("cx", mouseX + this.surface.leftMargin);
        this.cdfDot.attr("cy", (1 - pos) * this.surface.getActualChartHeight() + this.surface.topMargin);
        const cdf = percent(pos);
        this.pointDescription.update([xs, value, ys, size, percent(perc), cdf], mouseX, mouseY);
        this.legendPlot.hilight(colorIndex);
    }

    protected dragCanvasEnd() {
        const dragging = this.dragging && this.moved;
        super.dragEnd();
        if (!dragging)
            return;
        const position = d3mouse(this.surface.getCanvas().node());
        const x = position[0];
        this.selectionCompleted(this.selectionOrigin.x, x, false);
    }

    // dragging in the legend
   protected dragLegendStart() {
       this.dragging = true;
       this.moved = false;
       const position = d3mouse(this.legendSurface.getCanvas().node());
       this.selectionOrigin = {
           x: position[0],
           y: position[1] };
    }

    protected dragLegendMove(): void {
        if (!this.dragging)
            return;
        this.moved = true;
        let ox = this.selectionOrigin.x;
        const position = d3mouse(this.legendSurface.getCanvas().node());
        const x = position[0];
        let width = x - ox;
        const height = this.legendRect.height();

        if (width < 0) {
            ox = x;
            width = -width;
        }
        this.legendSelectionRectangle
            .attr("x", ox)
            .attr("width", width)
            .attr("y", this.legendRect.upperLeft().y)
            .attr("height", height);

        // Prevent the selection from spilling out of the legend itself
        if (ox < this.legendRect.origin.x) {
            const delta = this.legendRect.origin.x - ox;
            this.legendSelectionRectangle
                .attr("x", this.legendRect.origin.x)
                .attr("width", width - delta);
        } else if (ox + width > this.legendRect.lowerRight().x) {
            const delta = ox + width - this.legendRect.lowerRight().x;
            this.legendSelectionRectangle
                .attr("width", width - delta);
        }
    }

    protected dragLegendEnd(): void {
        if (!this.dragging || !this.moved)
            return;
        this.dragging = false;
        this.moved = false;
        this.legendSelectionRectangle
            .attr("width", 0)
            .attr("height", 0);

        const position = d3mouse(this.legendSurface.getCanvas().node());
        const x = position[0];
        this.selectionCompleted(this.selectionOrigin.x, x, true);
    }

    protected cancelDrag() {
        super.cancelDrag();
        this.legendSelectionRectangle
            .attr("width", 0)
            .attr("heigh", 0);
    }

    /**
     * * xl and xr are coordinates of the mouse position within the canvas or legendSvg respectively.
     */
    protected selectionCompleted(xl: number, xr: number, inLegend: boolean): void {
        let min: number;
        let max: number;
        let boundaries: string[] = null;
        let selectedAxis: AxisData = null;
        let scale: AnyScale = null;

        if (inLegend) {
            const legendX = this.legendRect.lowerLeft().x;
            xl -= legendX;
            xr -= legendX;
            selectedAxis = this.currentData.yData;
            scale = this.legendPlot.xScale;
        } else {
            xl -= this.surface.leftMargin;
            xr -= this.surface.leftMargin;
            selectedAxis = this.currentData.xData;
            scale = this.plot.xScale;
        }

        if (scale == null)
            return;

        const kind = selectedAxis.description.kind;
        const x0 = HistogramViewBase.invertToNumber(xl, scale, kind);
        const x1 = HistogramViewBase.invertToNumber(xr, scale, kind);

        // selection could be done in reverse
        [min, max] = reorder(x0, x1);
        if (min > max) {
            this.page.reportError("No data selected");
            return;
        }

        if (selectedAxis.distinctStrings != null)
            boundaries = selectedAxis.distinctStrings.categoriesInRange(min, max, max - min);
        const filter: FilterDescription = {
            min,
            max,
            kind: selectedAxis.description.kind,
            columnName: selectedAxis.description.name,
            bucketBoundaries: boundaries,
            complement: d3event.sourceEvent.ctrlKey,
        };

        const rr = this.createFilterRequest(filter);
        const renderer = new Filter2DReceiver(
            this.currentData.xData.description,
            this.currentData.yData.description,
            this.currentData.xData.distinctStrings,
            this.currentData.yData.distinctStrings,
            this.rowCount,
            this.schema,
            this.page, this.currentData.samplingRate >= 1.0, rr, false,
            this.dataset,
            this.relative);
        rr.invoke(renderer);
    }

   public static colorMap(d: number): string {
        // The rainbow color map starts and ends with a similar hue
        // so we skip the first 20% of it.
        return d3interpolateRainbow(d * .8 + .2);
    }

    // show the table corresponding to the data in the histogram
    protected showTable(): void {
        const order =  new RecordOrder([ {
            columnDescription: this.currentData.xData.description,
            isAscending: true,
        }, {
            columnDescription: this.currentData.yData.description,
            isAscending: true,
        } ]);

        const page = this.dataset.newPage("Table", this.page);
        const table = new TableView(this.remoteObjectId, this.rowCount, this.schema, page);
        const rr = table.createNextKRequest(order, null, Resolution.tableRowsOnScreen);
        page.setDataView(table);
        rr.invoke(new NextKReceiver(page, table, rr, false, order, null));
    }
}

/**
 * Receives the result of a filtering operation on two axes and initiates
 * a new 2D range computation, which in turns initiates a new 2D histogram
 * rendering.
 */
export class Filter2DReceiver extends BaseRenderer {
    constructor(protected xColumn: IColumnDescription,
                protected yColumn: IColumnDescription,
                protected xDs: DistinctStrings,
                protected yDs: DistinctStrings,
                protected rowCount: number,
                protected schema: SchemaClass,
                page: FullPage,
                protected exact: boolean,
                operation: ICancellable,
                protected heatMap: boolean,
                dataset: DatasetView,
                protected relative: boolean) {
        super(page, operation, "Filter", dataset);
    }

    public run(): void {
        super.run();
        const cds: IColumnDescription[] = [this.xColumn, this.yColumn];
        const ds: DistinctStrings[] = [this.xDs, this.yDs];
        const rx = new CategoricalValues(this.xColumn.name, this.xDs != null ? this.xDs.uniqueStrings : null);
        const ry = new CategoricalValues(this.yColumn.name, this.yDs != null ? this.yDs.uniqueStrings : null);
        const rr = this.remoteObject.createRange2DRequest(rx, ry);
        rr.invoke(new Range2DCollector(
            cds, this.rowCount, this.schema, ds, this.page, this.remoteObject, this.exact,
            rr, this.heatMap, this.relative, false));
    }
}

/**
 * This class is invoked by the ZipReceiver after a set operation
 * to create a new 2D histogram.
 */
export class Make2DHistogram extends BaseRenderer {
    public constructor(page: FullPage,
                       operation: ICancellable,
                       private colDesc: IColumnDescription[],
                       protected ds: DistinctStrings[],
                       private rowCount: number,
                       private schema: SchemaClass,
                       private exact: boolean,
                       private heatMap: boolean,
                       dataset: DatasetView,
                       private relative: boolean) {
        super(page, operation, "Reload", dataset);
    }

    public run(): void {
        super.run();
        const rx = new CategoricalValues(this.colDesc[0].name, this.ds[0] != null ? this.ds[0].uniqueStrings : null);
        const ry = new CategoricalValues(this.colDesc[1].name, this.ds[1] != null ? this.ds[1].uniqueStrings : null);
        const rr = this.remoteObject.createRange2DRequest(rx, ry);
        rr.chain(this.operation);
        rr.invoke(new Range2DCollector(
            this.colDesc, this.rowCount, this.schema, this.ds, this.page, this.remoteObject,
            this.exact, rr, this.heatMap, this.relative, false));
    }
}

/**
 * Receives partial results and renders a 2D histogram.
 * The 2D histogram data and the HeatMap data use the same data structure.
 */
export class Histogram2DRenderer extends Receiver<Pair<HeatMap, Histogram>> {
    protected histogram: Histogram2DView;

    constructor(page: FullPage,
                protected remoteObject: TableTargetAPI,
                protected rowCount: number,
                protected schema: SchemaClass,
                protected cds: IColumnDescription[],
                protected stats: BasicColStats[],
                protected samplingRate: number,
                protected distinctStrings: DistinctStrings[],
                operation: RpcRequest<PartialResult<Pair<HeatMap, Histogram>>>,
                protected relative: boolean,
                protected reusePage: boolean) {
        super(
            reusePage ? page : page.dataset.newPage(
                "Histogram(" + schema.displayName(cds[0].name) + ", " +
                schema.displayName(cds[1].name) + ")", page),
            operation, "histogram");
        this.histogram = new Histogram2DView(
            this.remoteObject.remoteObjectId, rowCount, schema, this.page);
        this.page.setDataView(this.histogram);
        if (cds.length !== 2 || stats.length !== 2 || distinctStrings.length !== 2)
            throw new Error("Expected 2 columns");
    }

    public onNext(value: PartialResult<Pair<HeatMap, Histogram>>): void {
        super.onNext(value);
        if (value == null)
            return;
        const heatMap = value.data.first;
        const cdf = value.data.second;
        const points = heatMap.buckets;
        let xPoints = 1;
        let yPoints = 1;
        if (points != null) {
            xPoints = points.length;
            yPoints = points[0] != null ? points[0].length : 1;
        }

        const xAxisData = new AxisData(this.cds[0], this.stats[0], this.distinctStrings[0], xPoints);
        const yAxisData = new AxisData(this.cds[1], this.stats[1], this.distinctStrings[1], yPoints);
        this.histogram.updateView(heatMap, xAxisData, yAxisData, cdf,
            this.samplingRate, this.relative, this.elapsedMilliseconds());
    }
}

export class Histogram2DDialog extends Dialog {
    public static label(heatmap: boolean): string {
        return heatmap ? "heatmap" : "2D histogram";
    }

    constructor(allColumns: string[], heatmap: boolean) {
        super(Histogram2DDialog.label(heatmap),
            "Display a " + Histogram2DDialog.label(heatmap) + " of the data in two columns");
        this.addSelectField("columnName0", "First Column", allColumns, allColumns[0],
            "First column (X axis)");
        this.addSelectField("columnName1", "Second Column", allColumns, allColumns[1],
            "Second column " + (heatmap ? "(Y axis)" : "(color)"));
    }

    public getColumn(first: boolean): string {
        if (first)
            return this.getFieldValue("columnName0");
        else
            return this.getFieldValue("columnName1");
    }
}
