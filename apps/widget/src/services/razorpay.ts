export type RazorpaySuccess = {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

export type RazorpayFailure = {
  error?: { code?: string; description?: string; reason?: string }
}

type CheckoutOptions = {
  key: string
  amount: number
  currency: string
  name: string
  description: string
  order_id: string
  prefill?: { contact?: string }
  theme?: { color?: string }
  handler: (response: RazorpaySuccess) => void | Promise<void>
  modal?: { ondismiss?: () => void }
}

type CheckoutInstance = {
  open(): void
  on(event: 'payment.failed', handler: (response: RazorpayFailure) => void): void
}

declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => CheckoutInstance
  }
}

let checkoutScript: Promise<void> | null = null

export function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve()
  if (checkoutScript) return checkoutScript

  checkoutScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.dataset.clinicflowRazorpay = 'true'
    script.onload = () => window.Razorpay ? resolve() : reject(new Error('Razorpay Checkout did not initialize.'))
    script.onerror = () => reject(new Error('Razorpay Checkout could not be loaded. Check your internet connection and try again.'))
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    checkoutScript = null
    throw error
  })

  return checkoutScript
}
