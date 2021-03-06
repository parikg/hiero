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

package org.hillview.jsonObjects;

import javax.annotation.Nullable;

@SuppressWarnings("CanBeFinal")
public class Histogram2DArgs {
    // fields are never really null, but we have no default initializer
    @Nullable
    public ColumnAndRange first;
    @Nullable
    public ColumnAndRange second;

    public int xBucketCount;
    public int yBucketCount;
    public double samplingRate;
    public long seed;
    // The following are only used for histograms, not for heatmaps.
    public int cdfBucketCount;
    public double cdfSamplingRate;
}
