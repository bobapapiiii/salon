import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/**
 * Hero image in its tall arch frame (GSAP-only component — no Framer Motion).
 * Entrance: clip-path inset 8%→0 reveal (1000ms). Then continuous parallax,
 * img y −8% scrubbed across the hero (home.md §2).
 */
export default function HeroImage() {
  const frameRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        frameRef.current,
        { clipPath: 'inset(8% 8% 8% 8% round 999px 999px 20px 20px)' },
        {
          clipPath: 'inset(0% 0% 0% 0% round 999px 999px 20px 20px)',
          duration: 1,
          ease: 'expo.out',
          delay: 0.35,
        },
      )
      gsap.fromTo(
        imgRef.current,
        { yPercent: 0 },
        {
          yPercent: -8,
          ease: 'none',
          scrollTrigger: {
            trigger: frameRef.current,
            start: 'top bottom',
            end: 'bottom top',
            scrub: true,
          },
        },
      )
    })
    return () => ctx.revert()
  }, [])

  return (
    <div
      ref={frameRef}
      className="overflow-hidden rounded-b-[20px] rounded-t-[999px] border-8 border-surface shadow-sh-2"
      style={{ clipPath: 'inset(0% 0% 0% 0% round 999px 999px 20px 20px)' }}
    >
      <img
        ref={imgRef}
        src="/hero-salon.jpg"
        alt="Sunlit interior of Lumina Salon — cream walls, terracotta arches and oak manicure tables"
        loading="eager"
        fetchPriority="high"
        className="aspect-[4/5] w-full scale-[1.12] object-cover"
      />
    </div>
  )
}
