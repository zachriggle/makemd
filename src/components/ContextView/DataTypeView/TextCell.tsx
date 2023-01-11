import React, { useEffect, useRef } from "react";
import { TableCellProp } from "../TableView/TableView";

export const TextCell = (props: TableCellProp) => {
  const { initialValue, saveValue } = props;

  const [value, setValue] = React.useState(initialValue);
  const ref = useRef(null);
  // When the input is blurred, we'll call our table meta's updateData function
  const onBlur = () => {
    if (initialValue != value) saveValue(value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key == "Enter") {
      (e.target as HTMLInputElement).blur();
      props.setEditMode(null);
    }
    if (e.key == "Escape") {
      setValue(initialValue);
      (e.target as HTMLInputElement).blur();
      props.setEditMode(null);
    }
  };

  // If the initialValue is changed external, sync it up with our state
  React.useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    if (props.editMode == 2) {
      ref?.current?.focus();
    }
  }, [props.editMode]);

  return props.editMode > 1 ? (
    <input
      onClick={(e) => e.stopPropagation()}
      className="mk-cell-text"
      ref={ref}
      type="text"
      value={value as string}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  ) : (
    <div className="mk-cell-text">{value}</div>
  );
};
