import ShopProductPage from './shop-product-page';

export const dynamic = 'force-dynamic';

export default function Page({ params }: { params: { slug: string } }) {
  const slug = decodeURIComponent(params.slug);
  return <ShopProductPage key={slug} slug={slug} />;
}
