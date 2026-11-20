import { ImageResponse } from 'next/og';
import { AppIcon } from '@/lib/appIcon';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(<AppIcon size={512} />, size);
}
