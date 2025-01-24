export interface SpriteCategory {
  name: string;
  folder: string;
  defaultOption: string;
  options: string[];
}
export const AdminSkinChanger = "j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI"
export const DefaultAtlasTxID = "sVIX0l_PFC6M7lYpuEOGJ_f5ESOkMxd5f5xCQSUH_2g"
export const Gateway = "https://arweave.net/"
export const SPRITE_CATEGORIES: SpriteCategory[] = [
  {
    name: 'Hair',
    folder: 'Hair',
    defaultOption: 'None',
    options: [
      'None',
      'Girl',
      'Boy',
    ]
  },
  {
    name: 'Hat',
    folder: 'Hat',
    defaultOption: 'None',
    options: [
      'None',
      'Beanie',
    ]
  },
  {
    name: 'Shirt',
    folder: 'Shirt',
    defaultOption: 'None',
    options: [
      'None',
      'Shirt',
      'Coat',
    ]
  },
  {
    name: 'Pants',
    folder: 'Pants',
    defaultOption: 'None',
    options: [
      'None',
      'Pants',
      'Skirt',
      'Shorts'
    ]
  },
  {
    name: 'Gloves',
    folder: 'Gloves',
    defaultOption: 'None',
    options: [
      'None',
      'Gloves',
    ]
  },
  {
    name: 'Shoes',
    folder: 'Shoes',
    defaultOption: 'None',
    options: [
      'None',
      'Shoes',
    ]
  },
];

export const PUBLIC_ASSETS_PATH = '/assets';
