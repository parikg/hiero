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

import {select as d3select} from "d3-selection";
import {FullPage} from "./fullPage";
import {TextOverlay} from "./textOverlay";
import {IHtmlElement, Size} from "./ui";

/**
 * A plotting surface contains an SVG element on top of which various charts are drawn.
 * There is a margin around the chart, which is dynamically computed.
 */
export class PlottingSurface implements IHtmlElement {
    public topLevel: HTMLDivElement;
    /**
     * Number of pixels on between the top of the SVG area and the top of the drawn chart.
     */
    public topMargin: number;
    /**
     * Number of pixels between the left of the SVG area and the left axis.
     */
    public leftMargin: number;
    /**
     * Number of pixels between the bottom of the SVG area and the bottom axis.
     */
    public bottomMargin: number;
    /**
     * Number of pixels between the right of the SVG area and the end of the drawn chart.
     */
    public rightMargin: number;
    /**
     * SVG element on top of which the chart is drawn.
     */
    public svgCanvas: any;
    /**
     * Current size in pixels of the canvas.
     */
    public size: Size;
    /**
     * An AVG g element which is used to draw the chart; it is offset from the
     * svgCanvas by leftMargin, topMargin.
     */
    public chartArea: any;
    /**
     * Describes the mouse pointer.  May be null.
     */
    public pointDescription: TextOverlay;

    public static readonly minCanvasWidth = 300; // minimum number of pixels for a plot (including margins)
    public static readonly canvasHeight = 500;   // size of a plot
    public static readonly topMargin = 10;        // top margin in pixels in a plot
    public static readonly rightMargin = 20;     // right margin in pixels in a plot
    public static readonly bottomMargin = 50;    // bottom margin in pixels in a plot
    public static readonly leftMargin = 40;      // left margin in pixels in a plot

    constructor(parent: HTMLElement, public readonly page: FullPage) {
        this.topLevel = document.createElement("div");
        parent.appendChild(this.topLevel);
        // Default margins.
        this.setMargins(PlottingSurface.topMargin, PlottingSurface.rightMargin,
            PlottingSurface.bottomMargin, PlottingSurface.leftMargin);
        this.size = PlottingSurface.getDefaultCanvasSize(this.page);
    }

    public static getDefaultCanvasSize(page: FullPage): Size {
        let width = page.getWidthInPixels() - 3;
        if (width < PlottingSurface.minCanvasWidth)
            width = PlottingSurface.minCanvasWidth;
        return { width, height: PlottingSurface.canvasHeight };
    }

    public static getDefaultChartSize(page: FullPage): Size {
        const canvasSize = PlottingSurface.getDefaultCanvasSize(page);
        const width = canvasSize.width - PlottingSurface.leftMargin - PlottingSurface.rightMargin;
        const height = canvasSize.height - PlottingSurface.topMargin - PlottingSurface.bottomMargin;
        return { width, height };
    }

    public clear() {
        if (this.svgCanvas != null)
            this.svgCanvas.remove();
        const size = PlottingSurface.getDefaultCanvasSize(this.page);
        this.size.width = Math.max(PlottingSurface.minCanvasWidth, size.width);

        this.svgCanvas = d3select(this.topLevel)
            .append("svg")
            .attr("id", "canvas")
            .attr("border", 1)
            .attr("cursor", "crosshair")
            .attr("width", this.size.width)
            .attr("height", this.size.height);
        this.chartArea = this.svgCanvas
            .append("g")
            .attr("transform", `translate(${this.leftMargin}, ${this.topMargin})`);
    }

    public getChart(): any {
        return this.chartArea;
    }

    public getCanvas(): any {
        return this.svgCanvas;
    }

    /**
     * The width of the drawn chart, excluding the margins, in pixels.
     */
    public getActualChartWidth(): number {
        return this.size.width - this.leftMargin - this.rightMargin;
    }

    /**
     * The height of the drawn chart, excluding the margins, in pixels.
     */
    public getActualChartHeight(): number {
        return this.size.height - this.topMargin - this.bottomMargin;
    }

    public getDefaultChartSize(): Size {
        return { width: this.getActualChartWidth(), height: this.getActualChartHeight() };
    }

    public getHTMLRepresentation(): HTMLElement {
        return this.topLevel;
    }

    /**
     * Set the canvas height.  The width is usually imposed by the browser window.
     * This does not trigger a redraw.
     */
    public setHeight(height: number): void {
        this.size.height = height;
    }

    /**
     * Set the margins for the chart area inside the canvas.
     * This does not trigger a redraw.
     * If a value is null then it is not changed.
     */
    public setMargins(top: number, right: number, bottom: number, left: number): void {
        if (top != null)
            this.topMargin = top;
        if (right != null)
            this.rightMargin = right;
        if (left != null)
            this.leftMargin = left;
        if (bottom != null)
            this.bottomMargin = bottom;
    }

    public reportError(message: string): void {
        this.page.reportError(message);
    }

    /**
     * Usually called after setting the margins; it causes the canvas position
     * to be recomputed.
     */
    public moveCanvas(): void {
        this.chartArea
            .attr("transform", `translate(${this.leftMargin}, ${this.topMargin})`);
    }
}
