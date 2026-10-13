import Foundation

/// Hands freed memory back to the system after a burst of large allocations.
///
/// Measured, not assumed: dragging the size slider re-decodes every frame at
/// each notch, and once it stops the allocator keeps the freed megabytes as a
/// reserve — about 7 MB of footprint that nothing will use again. Asking for
/// it back right after costs nothing noticeable and is skipped otherwise; the
/// everyday paths (typing, clicking, petting) allocate nothing that needs it.
enum MemoryTrim {
    private static let timer = ReusableTimer(tolerance: 0.5) {
        malloc_zone_pressure_relief(nil, 0)
        debugLog("memory trimmed")
    }

    /// Trims once things have been quiet for a second, so a slider drag is
    /// trimmed once at the end rather than at every notch.
    static func soon() {
        timer.schedule(after: 1)
    }
}
