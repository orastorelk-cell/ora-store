import React from 'react';
import { useStore } from '../context/StoreContext';
import { DeferredPanel } from './DeferredPanel';

const CartDrawer = React.lazy(() => import('./CartDrawer').then((module) => ({ default: module.CartDrawer })));
const CheckoutModal = React.lazy(() => import('./CheckoutModal').then((module) => ({ default: module.CheckoutModal })));
const ProductDetailModal = React.lazy(() => import('./ProductDetailModal').then((module) => ({ default: module.ProductDetailModal })));
const OrderTrackingModal = React.lazy(() => import('./OrderTrackingModal').then((module) => ({ default: module.OrderTrackingModal })));

const useEverOpened = (open: boolean) => {
  const [opened, setOpened] = React.useState(open);
  React.useEffect(() => { if (open) setOpened(true); }, [open]);
  return opened || open;
};

export const CustomerOverlays: React.FC = () => {
  const { isCartOpen, setIsCartOpen, isCheckoutOpen, closeCheckoutAndRestoreCart, selectedProduct, setSelectedProduct, isTrackingOpen, setIsTrackingOpen } = useStore();
  const [resumeCheckout] = React.useState(() => {
    try { return localStorage.getItem('ora_resume_checkout') === '1'; } catch { return false; }
  });
  // Keep each overlay mounted after its first use so drafts and existing effects
  // survive closing/reopening, as they did before loading the code on demand.
  const cart = useEverOpened(isCartOpen);
  const checkout = useEverOpened(isCheckoutOpen || resumeCheckout);
  const product = useEverOpened(Boolean(selectedProduct));
  const tracking = useEverOpened(isTrackingOpen);
  return <>
    <DeferredPanel active={isCartOpen} onClose={() => setIsCartOpen(false)}>{cart && <CartDrawer />}</DeferredPanel>
    <DeferredPanel active={isCheckoutOpen} onClose={closeCheckoutAndRestoreCart}>{checkout && <CheckoutModal />}</DeferredPanel>
    <DeferredPanel active={Boolean(selectedProduct)} onClose={() => setSelectedProduct(null)}>{product && <ProductDetailModal />}</DeferredPanel>
    <DeferredPanel active={isTrackingOpen} onClose={() => setIsTrackingOpen(false)}>{tracking && <OrderTrackingModal />}</DeferredPanel>
  </>;
};
