import { renderHook, act } from "@testing-library/react"
import { useDirtyForm } from "../../hooks/useDirtyForm.js"

describe("useDirtyForm", () => {
  // 4a
  test("initial state is clean", () => {
    const { result } = renderHook(() => useDirtyForm())
    expect(result.current.isDirty).toBe(false)
  })

  // 4b
  test("setInitial then check with same values → not dirty", () => {
    const { result } = renderHook(() => useDirtyForm())
    act(() => {
      result.current.setInitial({ name: "Acme" })
    })
    act(() => {
      result.current.check({ name: "Acme" })
    })
    expect(result.current.isDirty).toBe(false)
  })

  // 4c
  test("check with different values → dirty", () => {
    const { result } = renderHook(() => useDirtyForm())
    act(() => {
      result.current.setInitial({ name: "Acme" })
    })
    act(() => {
      result.current.check({ name: "Changed" })
    })
    expect(result.current.isDirty).toBe(true)
  })

  // 4d
  test("reset clears dirty state", () => {
    const { result } = renderHook(() => useDirtyForm())
    act(() => {
      result.current.setInitial({ name: "Acme" })
    })
    act(() => {
      result.current.check({ name: "Changed" })
    })
    expect(result.current.isDirty).toBe(true)
    act(() => {
      result.current.reset()
    })
    expect(result.current.isDirty).toBe(false)
  })

  // 4e
  test("check before setInitial does nothing", () => {
    const { result } = renderHook(() => useDirtyForm())
    act(() => {
      result.current.check({ name: "anything" })
    })
    expect(result.current.isDirty).toBe(false)
  })

  // 4f
  test("setInitial resets dirty state", () => {
    const { result } = renderHook(() => useDirtyForm())
    act(() => {
      result.current.setInitial({ name: "Acme" })
    })
    act(() => {
      result.current.check({ name: "Changed" })
    })
    expect(result.current.isDirty).toBe(true)
    act(() => {
      result.current.setInitial({ name: "NewBase" })
    })
    expect(result.current.isDirty).toBe(false)
  })
})
