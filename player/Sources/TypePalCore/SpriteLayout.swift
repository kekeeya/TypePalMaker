import CoreGraphics

/// Where frames sit inside the pet window.
///
/// Frames may have different sizes and aspect ratios. They all share one box
/// whose width fits the widest frame, and each is aspect-fitted into it and
/// stood on the bottom edge, so a pet keeps its feet on the ground when a
/// state swaps in a differently shaped image.
///
/// Rects use AppKit's orientation: origin bottom-left.
public enum SpriteLayout {
    public static func boxSize(height: CGFloat, imageSizes: [CGSize]) -> CGSize {
        let aspects = imageSizes
            .filter { $0.width > 0 && $0.height > 0 }
            .map { $0.width / $0.height }
        let widest = aspects.max() ?? 1
        return CGSize(width: (height * widest).rounded(.up), height: height)
    }

    public static func fitRect(for imageSize: CGSize, in box: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0 else {
            return CGRect(origin: .zero, size: box)
        }
        let scale = min(box.width / imageSize.width, box.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(x: (box.width - size.width) / 2, y: 0, width: size.width, height: size.height)
    }
}
