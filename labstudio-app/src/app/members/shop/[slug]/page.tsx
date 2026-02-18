import ShopProductPage from './shop-product-page';

export const dynamic = 'force-dynamic';

export default function Page({ params }: { params: { slug: string } }) {
  return <ShopProductPage slug={decodeURIComponent(params.slug)} />;
}
