import {
  closestCenter,
  DndContext,
  DragEndEvent, DragOverEvent,
  DragOverlay,
  DragStartEvent,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import {
  ColumnSizingState, flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel, OnChangeFn,
  RowData, useReactTable
} from "@tanstack/react-table";
import "css/Table.css";
import MakeMDPlugin from "main";
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { DBRow } from "types/mdb";
import {
  deleteFile,
  getAbstractFileAtPath,
  openAFile,
  platformIsMobile
} from "utils/file";
import { uniq } from "utils/tree";
import { BooleanCell } from "../DataTypeView/BooleanCell";
import { ContextCell } from "../DataTypeView/ContextCell";
import { DateCell } from "../DataTypeView/DateCell";
import { FileCell } from "../DataTypeView/FileCell";
import { FilePropertyCell } from "../DataTypeView/FilePropertyCell";
import { NumberCell } from "../DataTypeView/NumberCell";
import { OptionCell } from "../DataTypeView/OptionCell";
import { TextCell } from "../DataTypeView/TextCell";
import { MDBContext } from "../MDBContext";
import { ColumnHeader } from "./ColumnHeader";

import { isMouseEvent } from "hooks/useLongPress";
import { debounce } from "lodash";
import { Menu } from "obsidian";
import { fieldTypes } from "schemas/mdb";
import { saveFrontmatterValue } from "utils/contexts/fm";
import { createNewRow } from "utils/contexts/mdb";
import { Filter } from "utils/contexts/predicate/filter";
import { Sort } from "utils/contexts/predicate/sort";
import {
  selectNextIndex,
  selectPrevIndex,
  selectRange
} from "utils/ui/selection";
import { ImageCell } from "../DataTypeView/ImageCell";
import { LinkCell } from "../DataTypeView/LinkCell";
import { TagCell } from "../DataTypeView/TagCell";
import i18n from "i18n";

declare module "@tanstack/table-core" {
  interface ColumnMeta<TData extends RowData, TValue> {
    table: string;
    editable: boolean;
    schemaId: string;
  }
}

export enum CellEditMode {
  EditModeReadOnly = -1,
  EditModeNone = 0, //No Edit for Most Types except bool
  EditModeView = 1, //View mode, toggleable to edit mode
  EditModeActive = 2, //Active Edit mode, toggelable to view mode
  EditModeAlways = 3, //Always Edit
}

export type TableCellProp = {
  initialValue: string;
  saveValue: (value: string) => void;
  editMode: CellEditMode;
  setEditMode: (editMode: [string, string]) => void;
  plugin: MakeMDPlugin;
};

export type TableCellMultiProp = TableCellProp & {
  multi: boolean;
};

export const TableView = (props: { plugin: MakeMDPlugin }) => {
  const {
    selectedRows,
    selectRows,
    tableData,
    sortedColumns: cols,
    filteredData: data,
    tagContexts,
    folderPath,
    saveSchema,
    searchString,
    dbSchema,
    contextTable,
    setContextTable,
    predicate,
    savePredicate,
    saveDB,
    saveContextDB,
    schema,
    dbPath,
    saveColumn,
    delColumn,
    newColumn,
    isFolderContext,
  } = useContext(MDBContext);
  const [activeId, setActiveId] = useState(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<string>(null);
  const [selectedColumn, setSelectedColumn] = useState<string>(null);
  const [currentEdit, setCurrentEdit] = useState<[string, string]>(null);
  const [overId, setOverId] = useState(null);
  const [openFlows, setOpenFlows] = useState([]);
  const [selectNewOnRefresh, setSelectNewOnRefresh] = useState(false);
  const [colsSize, setColsSize] = useState<ColumnSizingState>({});
  const ref = useRef(null);
  useEffect(() => {
    setColsSize({ ...predicate.colsSize, "+": 30 });
  }, [predicate]);

  useEffect(() => {
    setCurrentEdit(null);
  }, [selectedColumn, lastSelectedIndex]);

  useEffect(() => {
    if (currentEdit == null) {
      ref.current.focus();
    }
  }, [currentEdit]);

  const saveColsSize: OnChangeFn<ColumnSizingState> = (
    colSize: (old: ColumnSizingState) => ColumnSizingState
  ) => {
    const newColSize = colSize(colsSize);
    setColsSize(newColSize);
    debouncedSavePredicate(newColSize);
  };

  const debouncedSavePredicate = useCallback(
    debounce(
      (nextValue) =>
        savePredicate({
          ...predicate,
          colsSize: nextValue,
        }),
      1000
    ),
    [predicate] // will be created only once initially
  );
  const newRow = (index?: number, data?: DBRow) => {
    saveDB(createNewRow(tableData, { File: "", ...(data ?? {}) }, index));
  };

  const deleteRow = (rowIndex: number) => {
    const row = tableData.rows.find((f, i) => i == rowIndex);
    if (row._source == "folder") {
      deleteFile(props.plugin, getAbstractFileAtPath(app, row.File));
    }
    if (row) {
      saveDB({
        ...tableData,
        rows: tableData.rows.filter((f, i) => i != rowIndex),
      });
    }
  };

  const toggleFlow = (path: string) => {
    setOpenFlows((f) =>
      f.find((p) => p == path) ? f.filter((p) => p != path) : uniq([...f, path])
    );
  };

  const selectItem = (modifier: number, index: string) => {
    if (modifier == 3) {
      const file = getAbstractFileAtPath(
        app,
        tableData.rows[parseInt(index)].File
      );
      if (file) openAFile(file, props.plugin, false);
      return;
    }
    if (modifier == 2) {
      selectedRows.some((f) => f == index)
        ? selectRows(
            null,
            selectedRows.filter((f) => f != index)
          )
        : selectRows(index, uniq([...selectedRows, index]));
    } else if (modifier == 1) {
      selectRows(
        index,
        uniq([
          ...selectedRows,
          ...selectRange(
            lastSelectedIndex,
            index,
            data.map((f) => f._index)
          ),
        ])
      );
    } else {
      selectRows(index, [index]);
    }
    setLastSelectedIndex(index);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const setCellValue = (value: string) => {
      const columnTuple = selectedColumn.split('#');
      updateData(parseInt(lastSelectedIndex), columnTuple[0], columnTuple[1] ?? '', value, '')
    }
    const clearCell = () => {
      setCellValue('')
    }
    const copyCell = () => {
      navigator.clipboard.writeText(tableData.rows[parseInt(lastSelectedIndex)][selectedColumn])
    }
    const nextRow = () => {
      const newIndex = selectNextIndex(
        lastSelectedIndex,
        data.map((f) => f._index)
      );
      selectRows(newIndex, [newIndex]);
      setLastSelectedIndex(newIndex);
    }
    const lastRow = () => {
      const newIndex = selectPrevIndex(
        lastSelectedIndex,
        data.map((f) => f._index)
      );
      selectRows(newIndex, [newIndex]);
      setLastSelectedIndex(newIndex);
    }
    if (e.key == 'c' && e.metaKey) {
      copyCell()
    }
    if (e.key == 'x' && e.metaKey) {
      copyCell();
      clearCell()
    }
    if (e.key == 'v' && e.metaKey) {
      navigator.clipboard.readText().then(f => setCellValue(f))
    }
    if (e.key == "Escape") {
      selectRows(null, []);
      setLastSelectedIndex(null);
    }
    if (e.key == 'Backspace' || e.key == 'Delete') {
      clearCell();
    }
    if (e.key == "Enter") {
      if (selectedColumn && lastSelectedIndex) {
        if (e.shiftKey) {
          newRow(parseInt(lastSelectedIndex)+1);
          nextRow();
        } else {
        setCurrentEdit([selectedColumn, lastSelectedIndex]);
        }
      }
        
      return;
    }
    if (e.key == "ArrowDown") {
      nextRow();
      e.preventDefault();
    }
    if (e.key == "ArrowUp") {
      lastRow();
      e.preventDefault();
    }
    if (e.key == "ArrowLeft") {
      const newIndex = selectPrevIndex(
        selectedColumn,
        columns.map((f) => f.accessorKey).filter((f) => f != "+")
      );
      setSelectedColumn(newIndex);
    }
    if (e.key == "ArrowRight") {
      const newIndex = selectNextIndex(
        selectedColumn,
        columns.map((f) => f.accessorKey).filter((f) => f != "+")
      );
      setSelectedColumn(newIndex);
    }
  };

  const columns: any[] = useMemo(
    () => [
      ...(cols
        ?.filter((f) => f.type != "preview")
        .map((f) => {
          return {
            header: f.name,
            accessorKey: f.name + f.table,
            // enableResizing: true,
            meta: {
              table: f.table,
              editable: f.primary != "true",
              schemaId: dbSchema?.id,
            },
            cell: ({
              // @ts-ignore
              getValue,
              // @ts-ignore
              row: { index },
              // @ts-ignore
              column: { id },
              // @ts-ignore
              cell,
              // @ts-ignore
              table,
            }) => {
              const initialValue = getValue();
              // We need to keep and update the state of the cell normally
              const rowIndex =
                f.table == ""
                  ? index
                  : parseInt((data[index] as DBRow)["_index" + f.table]);
              const saveValue = (value: string) => {
                if (initialValue != value)
                  table.options.meta?.updateData(
                    rowIndex,
                    f.name,
                    f.table,
                    value
                  );
              };
              const saveFieldValue = (fieldValue: string, value: string) => {
                table.options.meta?.updateFieldValue(
                  rowIndex,
                  f.name,
                  f.table,
                  fieldValue,
                  value
                );
              };
              const editMode = !cell.getIsGrouped()
                ? platformIsMobile()
                  ? CellEditMode.EditModeAlways
                  : currentEdit &&
                    currentEdit[0] == f.name + f.table &&
                    currentEdit[1] == index
                  ? CellEditMode.EditModeActive
                  : CellEditMode.EditModeView
                : CellEditMode.EditModeReadOnly;
              const cellProps = {
                initialValue: initialValue as string,
                saveValue: saveValue,
                plugin: props.plugin,
                setEditMode: setCurrentEdit,
                editMode,
              };
              const fieldType =
                fieldTypes.find((t) => f.type == t.type) ||
                fieldTypes.find((t) => f.type == t.multiType);
              if (!fieldType) {
                return <>{initialValue}</>;
              }
              if (fieldType.type == "file") {
                return (
                  <FileCell
                    {...cellProps}
                    multi={fieldType.multiType == f.type}
                    folder={folderPath}
                    isFolder={isFolderContext}
                    openFlow={() => toggleFlow(initialValue)}
                    deleteRow={() => deleteRow(index)}
                  ></FileCell>
                );
              } else if (fieldType.type == "boolean") {
                return <BooleanCell {...cellProps} column={f}></BooleanCell>;
              } else if (fieldType.type == "option") {
                return (
                  <OptionCell
                    {...cellProps}
                    options={f.value}
                    multi={fieldType.multiType == f.type}
                    saveOptions={saveFieldValue}
                  ></OptionCell>
                );
              } else if (fieldType.type == "date") {
                return <DateCell {...cellProps}></DateCell>;
              } else if (fieldType.type == "context") {
                return (
                  <ContextCell
                    {...cellProps}
                    multi={fieldType.multiType == f.type}
                    contextTable={contextTable[f.value]}
                    contextTag={f.value}
                  ></ContextCell>
                );
              } else if (fieldType.type == "fileprop") {
                return (
                  <FilePropertyCell
                    {...cellProps}
                    property={f.value}
                    file={data[index]["File"]}
                  ></FilePropertyCell>
                );
              } else if (fieldType.type == "tag") {
                return (
                  <TagCell
                    {...cellProps}
                    multi={fieldType.multiType == f.type}
                  ></TagCell>
                );
              } else if (fieldType.type == "number") {
                return <NumberCell {...cellProps}></NumberCell>;
              } else if (fieldType.type == "link") {
                return (
                  <LinkCell
                    {...cellProps}
                    multi={fieldType.multiType == f.type}
                    file={data[index]["File"]}
                  ></LinkCell>
                );
              } else if (fieldType.type == "image") {
                return <ImageCell {...cellProps}></ImageCell>;
              } else {
                return <TextCell {...cellProps}></TextCell>;
              }
            },
          };
        }) ?? []),
      {
        header: "+",
        meta: { schemaId: dbSchema?.id },
        accessorKey: "+",
        size: 20,
        cell: () => <></>,
      },
    ],
    [cols, currentEdit, predicate, contextTable, toggleFlow, openFlows]
  );
  const updateData = (
    index: number,
    column: string,
    table: string,
    value: string,
    file: string
  ) => {
    const col = cols.find((f) => f.table == table && f.name == column);
    saveFrontmatterValue(
      tableData.rows[index]?.File,
      column,
      value,
      col.type
    );

    if (table == "") {
      saveDB({
        ...tableData,
        rows: tableData.rows.map((r, i) =>
          i == index
            ? {
                ...r,
                [column]: value,
              }
            : r
        ),
      });
    } else if (contextTable[table]) {
      saveContextDB(
        {
          ...contextTable[table],
          rows: contextTable[table].rows.map((r, i) =>
            i == index
              ? {
                  ...r,
                  [column]: value,
                }
              : r
          ),
        },
        table
      );
    }
  }
  const groupBy = useMemo(
    () =>
      predicate.groupBy?.length > 0 &&
      cols.find((f) => f.name + f.table == predicate.groupBy[0])
        ? predicate.groupBy
        : [],
    [predicate, cols]
  );
  const table = useReactTable({
    data,
    columns,
    columnResizeMode: "onChange",
    state: {
      columnVisibility: predicate.colsHidden.reduce(
        (p, c) => ({ ...p, [c]: false }),
        {}
      ),
      columnOrder: predicate.colsOrder,
      columnSizing: {
        ...columns.reduce((p, c) => ({ ...p, [c.accessorKey]: 150 }), {}),
        ...colsSize,
      },
      grouping: groupBy,
      expanded: true,
    },
    onColumnSizingChange: saveColsSize,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    meta: {
      updateData: updateData,
      updateFieldValue: (
        index: number,
        column: string,
        table: string,
        fieldValue: string,
        value: string
      ) => {
        const col = cols.find((f) => f.table == table && f.name == column);
        saveFrontmatterValue(
          tableData.rows[index]?.File,
          column,
          value,
          col.type
        );

        if (table == "") {
          const newTable = {
            ...tableData,
            cols: tableData.cols.map((m) =>
              m.name == column
                ? {
                    ...m,
                    value: fieldValue,
                  }
                : m
            ),
            rows: tableData.rows.map((r, i) =>
              i == index
                ? {
                    ...r,
                    [column]: value,
                  }
                : r
            ),
          };
          saveDB(newTable);
        } else if (contextTable[table]) {
          saveContextDB(
            {
              ...contextTable[table],
              cols: contextTable[table].cols.map((m) =>
                m.name == column
                  ? {
                      ...m,
                      value: fieldValue,
                    }
                  : m
              ),
              rows: contextTable[table].rows.map((r, i) =>
                i == index
                  ? {
                      ...r,
                      [column]: value,
                    }
                  : r
              ),
            },
            table
          );
        }
      },
    },
  });

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    })
  );
  const measuring = {
    droppable: {
      strategy: MeasuringStrategy.Always,
    },
  };

  function handleDragStart(event: DragStartEvent) {
    const {
      active: { id: activeId },
    } = event;
    setActiveId(activeId);
    setOverId(overId);

    document.body.style.setProperty("cursor", "grabbing");
  }

  function handleDragOver({ over }: DragOverEvent) {
    const overId = over?.id;
    if (overId) {
      setOverId(over?.id ?? null);
    }
  }

  const saveFilter = (filter: Filter) => {
    savePredicate({
      ...predicate,
      filters: [
        ...predicate.filters.filter((s) => s.field != filter.field),
        filter,
      ],
    });
  };

  const saveSort = (sort: Sort) => {
    savePredicate({
      ...predicate,
      sort: [sort],
    });
  };

  const hideCol = (col: string) => {
    savePredicate({
      ...predicate,
      colsHidden: [...predicate.colsHidden.filter((s) => s != col), col],
    });
  };

  const selectCell = (e: React.MouseEvent, index: number, column: string) => {
    if (platformIsMobile() || column == "+") return;
    selectItem(0, (data[index] as DBRow)["_index"]);
    setSelectedColumn(column);
    if (e.detail === 1) {
    } else if (e.detail === 2) {
      setCurrentEdit([column, (data[index] as DBRow)["_index"]]);
    }
  };
  const showContextMenu = (
    e: React.MouseEvent | React.TouchEvent,
    index: number
  ) => {
    e.preventDefault();
    const menu = new Menu();
    menu.addItem((item) => {
      item.setIcon('trash');
      item.setTitle(i18n.menu.deleteRow);
      item.onClick(() => {
        deleteRow(index);
      });
    });
    if (isMouseEvent(e)) {
      menu.showAtPosition({ x: e.pageX, y: e.pageY });
    } else {
      menu.showAtPosition({
        // @ts-ignore
        x: e.nativeEvent.locationX,
        // @ts-ignore
        y: e.nativeEvent.locationY,
      });
    }
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    resetState();
    savePredicate({
      ...predicate,
      colsOrder: arrayMove(
        predicate.colsOrder,
        predicate.colsOrder.findIndex((f) => f == activeId),
        predicate.colsOrder.findIndex((f) => f == overId)
      ),
    });
    // moveFile(active, over)
    // }
  }

  function handleDragCancel() {
    resetState();
  }
  function resetState() {
    setOverId(null);
    setActiveId(null);
    // setDropPlaceholderItem(null);
    document.body.style.setProperty("cursor", "");
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={measuring}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="mk-table" ref={ref} tabIndex={1} onKeyDown={onKeyDown}>
        <table
          {
            ...{
              // style: {
              //   width: table.getTotalSize(),
              // },
            }
          }
        >
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}><th></th>
                {headerGroup.headers.map((header) => (
                  <th
                    className="mk-th"
                    key={header.id}
                    style={{
                      minWidth: header.column.getIsGrouped()
                        ? "0px"
                        // @ts-ignore
                        : colsSize[header.column.columnDef.accessorKey] ??
                          "150px",
                    }}
                  >
                    {header.isPlaceholder ? null : header.column.columnDef
                        .header != "+" ? (
                      header.column.getIsGrouped() ? (
                        <></>
                      ) : (
                        <ColumnHeader
                          plugin={props.plugin}
                          editable={header.column.columnDef.meta.editable}
                          column={cols.find(
                            (f) =>
                              f.name == header.column.columnDef.header &&
                              f.table == header.column.columnDef.meta.table
                          )}
                          saveColumn={saveColumn}
                          deleteColumn={delColumn}
                          hide={hideCol}
                          filter={saveFilter}
                          sort={saveSort}
                        ></ColumnHeader>
                      )
                    ) : (
                      <ColumnHeader
                        plugin={props.plugin}
                        isNew={true}
                        editable={true}
                        column={{
                          name: "",
                          schemaId: header.column.columnDef.meta.schemaId,
                          type: "text",
                          table: "",
                        }}
                        saveColumn={newColumn}
                        deleteColumn={delColumn}
                      ></ColumnHeader>
                    )}
                    <div
                      {...{
                        onMouseDown: header.getResizeHandler(),
                        onTouchStart: header.getResizeHandler(),
                        className: `mk-resizer ${
                          header.column.getIsResizing() ? "isResizing" : ""
                        }`,
                      }}
                    />
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <>
                <tr
                  className={
                    selectedRows?.some(
                      (f) => f == (data[row.index] as DBRow)["_index"]
                    ) && "mk-is-active"
                  }
                  onContextMenu={(e) => {
                    const rowIndex = parseInt(
                      (data[row.index] as DBRow)["_index"]
                    );
                    showContextMenu(e, rowIndex);
                  }}
                  key={row.id}
                >
                  <td></td>
                  {row.getVisibleCells().map((cell) =>
                    cell.getIsGrouped() ? (
                      // If it's a grouped cell, add an expander and row count
                      <td className="mk-td-group" colSpan={cols.length + 1}>
                        <div
                          {...{
                            onClick: row.getToggleExpandedHandler(),
                            style: {
                              display: "flex",
                              alignItems: "center",
                              cursor: "normal",
                            },
                          }}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}{" "}
                          ({row.subRows.length})
                        </div>
                      </td>
                    ) : cell.getIsAggregated() ? (
                      // If the cell is aggregated, use the Aggregated
                      // renderer for cell
                      flexRender(
                        cell.column.columnDef.aggregatedCell ??
                          cell.column.columnDef.cell,
                        cell.getContext()
                      )
                    ) : (
                      <td
                        onClick={(e) =>
                          selectCell(
                            e,
                            cell.row.index,
                            // @ts-ignore
                            cell.column.columnDef.accessorKey
                          )
                        }
                        className={`${
                          // @ts-ignore
                          cell.column.columnDef.accessorKey == selectedColumn
                            ? "mk-selected-cell  "
                            : ""
                        } mk-td ${
                          cell.getIsPlaceholder() ? "mk-td-empty" : ""
                        }`}
                        key={cell.id}
                        style={{
                          minWidth: cell.getIsPlaceholder()
                            ? "0px"
                            // @ts-ignore
                            : colsSize[cell.column.columnDef.accessorKey] ??
                              "50px",
                        }}
                      >
                        {cell.getIsPlaceholder()
                          ? null
                          : flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                      </td>
                    )
                  )}
                </tr>
              </>
            ))}
          </tbody>
          <tfoot>
            {isFolderContext ? (
              <tr>
                <th
                  className="mk-row-new"
                  colSpan={cols.length + 2}
                  onClick={() => {
                    newRow();
                  }}
                >
                  + New
                </th>
              </tr>
            ) : (
              <></>
            )}
            {table.getFooterGroups().map((footerGroup) => (
              <tr key={footerGroup.id}>
                {footerGroup.headers.map((header) => (
                  <th key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.footer,
                          header.getContext()
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </tfoot>
        </table>
        {createPortal(
          <DragOverlay dropAnimation={null} zIndex={1600}>
            {activeId ? (
              <ColumnHeader
                plugin={props.plugin}
                editable={false}
                column={{
                  name: activeId,
                  schemaId: tableData.schema.id,
                  type: "text",
                  table: "",
                }}
                saveColumn={newColumn}
                deleteColumn={delColumn}
              ></ColumnHeader>
            ) : null}
          </DragOverlay>,
          document.body
        )}
      </div>
    </DndContext>
  );
};
