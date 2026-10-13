import AppKit

/// A slider with one tick mark — at `markedValue`, the pet's original size —
/// drawn as a larger dot than the rest.
///
/// The slider itself is left exactly as the system draws it: the larger dot
/// is a separate view behind it, so the knob passes over it like over any
/// other tick.
final class MarkedSlider: NSView {
    let slider: NSSlider
    private let dot: MarkDot

    init(slider: NSSlider, markedValue: Double) {
        self.slider = slider
        dot = MarkDot(slider: slider, value: markedValue)
        super.init(frame: .zero)
        for view in [dot, slider] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
            NSLayoutConstraint.activate([
                view.leadingAnchor.constraint(equalTo: leadingAnchor),
                view.trailingAnchor.constraint(equalTo: trailingAnchor),
                view.topAnchor.constraint(equalTo: topAnchor),
                view.bottomAnchor.constraint(equalTo: bottomAnchor),
            ])
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }
}

private final class MarkDot: NSView {
    private weak var slider: NSSlider?
    private let value: Double
    /// The system's tick dots are 2 pt across.
    private static let diameter: CGFloat = 4.5

    init(slider: NSSlider, value: Double) {
        self.slider = slider
        self.value = value
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        guard let slider, let centre = tickCentre(in: slider) else { return }
        let d = Self.diameter
        NSColor.secondaryLabelColor.setFill()
        NSBezierPath(ovalIn: NSRect(x: centre.x - d / 2, y: centre.y - d / 2, width: d, height: d)).fill()
    }

    /// Where the system draws the tick for `value`, in this view.
    private func tickCentre(in slider: NSSlider) -> NSPoint? {
        guard slider.numberOfTickMarks > 1, slider.maxValue > slider.minValue else { return nil }
        let step = (slider.maxValue - slider.minValue) / Double(slider.numberOfTickMarks - 1)
        let index = Int(((value - slider.minValue) / step).rounded())

        if #available(macOS 26, *) {
            // The redesigned slider puts its ticks along its bottom edge, each
            // under the knob's centre at that value; rectOfTickMark does not
            // report them.
            guard let cell = slider.cell as? NSSliderCell else { return nil }
            let saved = cell.doubleValue
            cell.doubleValue = slider.minValue
            let first = cell.knobRect(flipped: true).midX
            cell.doubleValue = slider.maxValue
            let last = cell.knobRect(flipped: true).midX
            cell.doubleValue = saved
            let x = first + (last - first) * CGFloat(index) / CGFloat(slider.numberOfTickMarks - 1)
            return convert(NSPoint(x: x, y: slider.bounds.maxY - 1.25), from: slider)
        }
        let tick = slider.rectOfTickMark(at: index)
        return convert(NSPoint(x: tick.midX, y: tick.midY), from: slider)
    }
}
