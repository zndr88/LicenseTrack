import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import DiscardChangesDialog from "../../components/ui/DiscardChangesDialog.jsx"

vi.mock("../../components/ui/Icon.jsx", () => ({
  default: () => null,
}))

describe("DiscardChangesDialog", () => {
  test("renders title, message, and actions", () => {
    render(<DiscardChangesDialog onDiscard={vi.fn()} onKeep={vi.fn()} />)

    expect(screen.getByRole("dialog", { name: /discard unsaved changes/i })).toBeInTheDocument()
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument()
    expect(screen.getByText("Your edits will be lost if you close without saving.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /keep editing/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^discard$/i })).toBeInTheDocument()
  })

  test("discard and keep callbacks fire from their buttons", () => {
    const onDiscard = vi.fn()
    const onKeep = vi.fn()
    render(<DiscardChangesDialog onDiscard={onDiscard} onKeep={onKeep} />)

    fireEvent.click(screen.getByRole("button", { name: /keep editing/i }))
    expect(onKeep).toHaveBeenCalledTimes(1)
    expect(onDiscard).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  test("outside click remains swallowed without discarding or keeping", () => {
    const onDiscard = vi.fn()
    const onKeep = vi.fn()
    render(<DiscardChangesDialog onDiscard={onDiscard} onKeep={onKeep} />)

    fireEvent.click(document.querySelector(".overlay"))

    expect(onDiscard).not.toHaveBeenCalled()
    expect(onKeep).not.toHaveBeenCalled()
  })
})
