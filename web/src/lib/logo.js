import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export function logoPublicUrl(path) {
  if (!path || !supabase) return ''
  return supabase.storage.from('company-logos').getPublicUrl(path).data.publicUrl
}

export function useLogoUrl(path) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!path || !supabase) {
      setUrl('')
      return undefined
    }
    let alive = true
    supabase.storage.from('company-logos').createSignedUrl(path, 3600).then(({ data }) => {
      if (alive) setUrl(data?.signedUrl || '')
    })
    return () => { alive = false }
  }, [path])

  return url
}
