import Select from "react-select"

export type SearchableOption = { value: string; label: string }

type Props = {
    id: string
    value: string
    onChange: (value: string) => void
    options: SearchableOption[]
    placeholder: string
    disabled?: boolean
}

/** A styled searchable dropdown used anywhere the app offers a fixed choice. */
export default function SearchableSelect({ id, value, onChange, options, placeholder, disabled = false }: Props) {
    return <Select
        inputId={id}
        isSearchable
        isClearable={false}
        isDisabled={disabled}
        options={options}
        value={options.find((option) => option.value === value) ?? null}
        onChange={(option) => { if (option) onChange(option.value) }}
        placeholder={placeholder}
        noOptionsMessage={() => "No matching options"}
        styles={{
            control: (base, state) => ({ ...base, minHeight: 44, borderRadius: 0, borderColor: state.isFocused ? "#71717a" : "var(--select-border)", boxShadow: state.isFocused ? "0 0 0 1px #71717a" : "none", backgroundColor: "var(--select-surface)", color: "var(--select-text)", fontSize: 14, cursor: "text", "&:hover": { borderColor: "#71717a" } }),
            valueContainer: (base) => ({ ...base, padding: "2px 12px" }),
            singleValue: (base) => ({ ...base, color: "var(--select-text)" }),
            input: (base) => ({ ...base, color: "var(--select-text)" }),
            placeholder: (base) => ({ ...base, color: "#a1a1aa" }),
            menu: (base) => ({ ...base, zIndex: 50, borderRadius: 0, marginTop: 4, backgroundColor: "var(--select-surface)", boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)" }),
            menuList: (base) => ({ ...base, padding: 4, maxHeight: 220 }),
            option: (base, state) => ({ ...base, fontSize: 13, borderRadius: 0, cursor: "pointer", backgroundColor: state.isFocused ? "var(--select-highlight)" : "var(--select-surface)", color: "var(--select-text)", "&:active": { backgroundColor: "var(--select-highlight)" } }),
            indicatorSeparator: () => ({ display: "none" }),
            dropdownIndicator: (base) => ({ ...base, color: "#71717a", padding: "0 10px" }),
        }}
    />
}
