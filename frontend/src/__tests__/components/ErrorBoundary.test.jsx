import React from "react"
import { render, screen } from "@testing-library/react"
import ErrorBoundary from "../../components/ErrorBoundary.jsx"

describe("ErrorBoundary", () => {
  // 5k
  test("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div>Normal content</div>
      </ErrorBoundary>
    )
    expect(screen.getByText("Normal content")).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  // 5l
  test("renders fallback UI when a child throws", () => {
    const Bomb = () => {
      throw new Error("Test explosion")
    }
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const suppressExpectedError = (event) => {
      if (event.error?.message === "Test explosion") {
        event.preventDefault()
      }
    }
    window.addEventListener("error", suppressExpectedError)
    try {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      )
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
      expect(screen.queryByText("Normal content")).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: /reload page/i })).toBeInTheDocument()
    } finally {
      window.removeEventListener("error", suppressExpectedError)
      consoleSpy.mockRestore()
    }
  })
})
