import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import ConfirmDialog from "../../components/ui/ConfirmDialog.jsx"

vi.mock("../../components/ui/Icon.jsx", () => ({
  default: () => null,
}))

// useFocusTrap runs in jsdom without issues — no mock needed.
// The rAF-based focus movement is a no-op for these click tests.

describe("ConfirmDialog", () => {
  // 5f
  test("renders with correct title and message", () => {
    render(
      <ConfirmDialog
        title="Delete item"
        message="Are you sure?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByText("Are you sure?")).toBeInTheDocument()
    expect(screen.getByText("Delete item")).toBeInTheDocument()
  })

  // 5g
  test("confirm button calls onConfirm, not onCancel", () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="Delete item"
        message="Are you sure?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  // 5h
  test("cancel button calls onCancel, not onConfirm", () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="Delete item"
        message="Are you sure?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  // 5i
  test("custom labels render correctly", () => {
    render(
      <ConfirmDialog
        title="Remove"
        message="This will delete it."
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument()
  })

  // 5j
  test("clicking the overlay calls onCancel", () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="Delete item"
        message="Are you sure?"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    )
    fireEvent.click(document.querySelector(".overlay"))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test("clicking inside the dialog does not call onCancel", () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="Delete item"
        message="Are you sure?"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByRole("dialog"))
    expect(onCancel).not.toHaveBeenCalled()
  })

  test("close button calls onCancel", () => {
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        title="Delete item"
        message="Are you sure?"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: /close/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
