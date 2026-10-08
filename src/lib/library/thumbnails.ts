const MAX_EDGE = 512;

export async function coverThumbnail(blob: Blob): Promise<Blob> {
  if (typeof createImageBitmap === 'undefined') return blob;
  let image: ImageBitmap | undefined;
  try {
    image = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return blob;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((result) => resolve(result ?? blob), 'image/webp', 0.85),
    );
  } catch {
    return blob;
  } finally {
    image?.close();
  }
}
