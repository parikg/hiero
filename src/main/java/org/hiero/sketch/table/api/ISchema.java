package org.hiero.sketch.table.api;

import org.hiero.sketch.table.ColumnDescription;

/**
 * Represents the schema of a table.
 */
public interface ISchema {
    ColumnDescription getDescription(int index);
    int getColumnCount();
    int getColumnIndex(String columnName);
    ISchema project(ISubSchema subSchema);

    default ContentsKind getKind(final String colName){
        return this.getDescription(this.getColumnIndex(colName)).kind;
    }
}
