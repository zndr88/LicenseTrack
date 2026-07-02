import React from "react"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { useFocusTrap } from "../../hooks/useFocusTrap.js"

function TrapFixture({ isOpen }) {
  const { modalRef, onKeyDown } = useFocusTrap(isOpen)
  return (
    <div ref={modalRef} onKeyDown={onKeyDown}>
      <button>First</button>
      <button>Second</button>
    </div>
  )
}

describe("useFocusTrap", () => {
  beforeEach(() => {
    // Make requestAnimationFrame synchronous so focus moves happen immediately
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0)
      return 0
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // 4g
  test("focus moves into container on open", async () => {
    render(<TrapFixture isOpen={true} />)
    await act(async () => {})
    const buttons = screen.getAllByRole("button")
    expect(document.activeElement).toBe(buttons[0])
  })

  // 4h
  test("focus is NOT moved when isOpen is false", async () => {
    render(<TrapFixture isOpen={false} />)
    await act(async () => {})
    const buttons = screen.getAllByRole("button")
    expect(document.activeElement).not.toBe(buttons[0])
  })

  // 4i
  test("Tab wraps from last to first", async () => {
    const { container } = render(<TrapFixture isOpen={true} />)
    await act(async () => {})
    const buttons = screen.getAllByRole("button")
    // Move focus to the last button
    buttons[1].focus()
    expect(document.activeElement).toBe(buttons[1])
    // Fire Tab — should wrap to first
    fireEvent.keyDown(container.firstChild, { key: "Tab", shiftKey: false })
    expect(document.activeElement).toBe(buttons[0])
  })

  // 4j
  test("Shift+Tab wraps from first to last", async () => {
    const { container } = render(<TrapFixture isOpen={true} />)
    await act(async () => {})
    const buttons = screen.getAllByRole("button")
    // Focus should already be on first button from the rAF flush
    buttons[0].focus()
    expect(document.activeElement).toBe(buttons[0])
    // Fire Shift+Tab — should wrap to last
    fireEvent.keyDown(container.firstChild, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(buttons[1])
  })
})
