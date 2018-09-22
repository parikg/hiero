package org.hillview.sketches;

import it.unimi.dsi.fastutil.ints.Int2ObjectOpenCustomHashMap;
import it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap;
import org.hillview.dataset.api.ISketch;
import org.hillview.table.api.IRowIterator;
import org.hillview.table.api.ITable;
import org.hillview.table.rows.BaseRowSnapshot;
import org.hillview.table.rows.RowSnapshot;
import org.hillview.table.rows.VirtualRowHashStrategy;
import org.hillview.table.rows.VirtualRowSnapshot;
import org.hillview.utils.MutableInteger;

import javax.annotation.Nullable;

public class ExactCountSketch implements ISketch<ITable, FreqKList> {
    public CountSketchResult result;
    public double threshold;

    public ExactCountSketch(CountSketchResult result, double threshold) {
        this.result = result;
        this.threshold = threshold;
    }

    public boolean aboveThreshold(BaseRowSnapshot rss) {
        return (this.result.estimateFreq(rss)> this.threshold*this.result.estimateNorm());
    }

    @Override
    public FreqKList create(ITable data) {
        VirtualRowHashStrategy hashStrategy = new VirtualRowHashStrategy(data,
                this.result.csDesc.schema);
        Int2ObjectOpenCustomHashMap<MutableInteger> hMap =
                new Int2ObjectOpenCustomHashMap<MutableInteger>(hashStrategy);
        VirtualRowSnapshot vrs = new VirtualRowSnapshot(data, result.csDesc.schema);
        IRowIterator rowIt = data.getRowIterator();
        int i = rowIt.getNextRow();
        MutableInteger val;
        while (i != -1) {
            val = hMap.get(i);
            if (val != null) {
                val.set(val.get() + 1);
            } else {
                vrs.setRow(i);
                if (this.aboveThreshold(vrs))
                    hMap.put(i, new MutableInteger(1));
            }
            i = rowIt.getNextRow();
        }
        Object2IntOpenHashMap<RowSnapshot> hm =  hashStrategy.materializeHashMap(hMap);
        return new FreqKList(data.getNumOfRows(), threshold, hm);
    }

    @Nullable
    @Override
    public FreqKList zero() {
        return null;
    }

    @Nullable
    @Override
    public FreqKList add(@Nullable FreqKList left, @Nullable FreqKList right) {
        return new FreqKList(left.totalRows + right.totalRows, this.threshold,
                FreqKList.getUnion(left, right));
    }
}
