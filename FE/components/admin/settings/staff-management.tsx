"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"

import { useStaffSession } from "@/components/providers/staff-session"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DateDisplay } from "@/components/ui/date-display"
import { ConfirmDialog, Dialog } from "@/components/ui/dialog"
import { StaffRoleSelect } from "@/components/ui/enum-select"
import { FormField } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/ui/page-header"
import { Notice } from "@/components/ui/section"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApiData } from "@/hooks/use-api-data"
import { adminApi } from "@/lib/api"
import { meetsPasswordPolicy } from "@/lib/auth"
import {
  PasswordInput,
  PasswordRequirements,
} from "@/components/ui/password-input"
import { Section } from "@/components/ui/section"
import { errorMessage } from "@/lib/errors"
import type { StaffAccount } from "@/types/entities"
import { STAFF_ROLE, type StaffRole } from "@/types/enums"

type Mode =
  | { kind: "create" }
  | { kind: "role"; account: StaffAccount }
  | { kind: "password"; account: StaffAccount }
  | { kind: "toggle"; account: StaffAccount }
  | { kind: "unlock"; account: StaffAccount }

/**
 * §8 decision 7 — ADMIN only (BE: requireStaff("ADMIN")). Neither this nor the
 * CLI can leave the system without an active ADMIN; BE answers 409 and the
 * message is shown as is.
 */
export function StaffManagement() {
  const session = useStaffSession()
  const selfId = session.status === "authenticated" ? session.staff.id : null
  const accounts = useApiData("staff", () => adminApi.staff.list())
  const [mode, setMode] = React.useState<Mode | null>(null)
  const [flash, setFlash] = React.useState<string | null>(null)

  async function done(text: string) {
    setMode(null)
    setFlash(text)
    await accounts.reload()
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/settings"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" aria-hidden />
        Tetapan akaun
      </Link>
      <PageHeader
        title="Pengurusan Staf"
        description="Perubahan peranan berkuat kuasa pada permintaan seterusnya. Set semula kata laluan dan nyahaktif melog keluar akaun serta-merta."
        actions={
          <Button
            onClick={() => {
              setFlash(null)
              setMode({ kind: "create" })
            }}
          >
            Akaun baharu
          </Button>
        }
      />

      {flash && <Notice tone="success">{flash}</Notice>}

      <SecuritySettingsCard />

      {accounts.status === "error" ? (
        <ErrorState
          error={accounts.error}
          onRetry={() => void accounts.reload()}
        />
      ) : !accounts.data ? (
        <LoadingState />
      ) : accounts.data.length === 0 ? (
        <EmptyState title="Tiada akaun" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nama</TableHead>
              <TableHead>E-mel</TableHead>
              <TableHead>Peranan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Log masuk terakhir</TableHead>
              <TableHead className="text-right">Tindakan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.data.map((a) => (
              <TableRow
                key={a.id}
                className={a.isActive ? undefined : "text-muted-foreground"}
              >
                <TableCell className="font-medium">
                  {a.fullName}
                  {a.id === selfId && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (anda)
                    </span>
                  )}
                </TableCell>
                <TableCell>{a.email ?? "—"}</TableCell>
                <TableCell>{STAFF_ROLE[a.role]}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={a.isActive ? "calm" : "neutral"}>
                      {a.isActive ? "Aktif" : "Tidak aktif"}
                    </Badge>
                    {a.locked && <Badge tone="accent">Disekat</Badge>}
                    {a.passwordChangeRequired && (
                      <Badge tone="outline">Perlu tukar kata laluan</Badge>
                    )}
                    {!a.hasPassword && (
                      <Badge tone="outline">Tiada kata laluan</Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <DateDisplay
                    value={a.lastLoginAt}
                    kind="datetime"
                    fallback="Belum pernah"
                  />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {a.locked && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Buka sekatan ${a.fullName}`}
                        onClick={() => {
                          setFlash(null)
                          setMode({ kind: "unlock", account: a })
                        }}
                      >
                        Buka sekatan
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Tukar peranan ${a.fullName}`}
                      onClick={() => {
                        setFlash(null)
                        setMode({ kind: "role", account: a })
                      }}
                    >
                      Peranan
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Set semula kata laluan ${a.fullName}`}
                      onClick={() => {
                        setFlash(null)
                        setMode({ kind: "password", account: a })
                      }}
                    >
                      Kata laluan
                    </Button>
                    <Button
                      variant={a.isActive ? "destructive" : "outline"}
                      size="sm"
                      aria-label={`${a.isActive ? "Nyahaktif" : "Aktifkan"} ${a.fullName}`}
                      onClick={() => {
                        setFlash(null)
                        setMode({ kind: "toggle", account: a })
                      }}
                    >
                      {a.isActive ? "Nyahaktif" : "Aktifkan"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {mode?.kind === "create" && (
        <CreateDialog onClose={() => setMode(null)} onDone={done} />
      )}
      {mode?.kind === "role" && (
        <RoleDialog
          account={mode.account}
          isSelf={mode.account.id === selfId}
          onClose={() => setMode(null)}
          onDone={done}
        />
      )}
      {mode?.kind === "password" && (
        <PasswordDialog
          account={mode.account}
          onClose={() => setMode(null)}
          onDone={done}
        />
      )}
      <ConfirmDialog
        open={mode?.kind === "unlock"}
        onOpenChange={(o) => !o && setMode(null)}
        title={
          mode?.kind === "unlock"
            ? `Buka sekatan ${mode.account.fullName}?`
            : ""
        }
        description="Akaun ini disekat selepas 5 cubaan kata laluan yang gagal. Pastikan cubaan itu bukan serangan sebelum membuka sekatan; pemilik juga boleh menggunakan Lupa kata laluan."
        confirmLabel="Buka sekatan"
        onConfirm={async () => {
          if (mode?.kind !== "unlock") return
          const a = mode.account
          await adminApi.staff.unlock(a.id)
          await done(`Sekatan ${a.fullName} dibuka.`)
        }}
      />
      <ConfirmDialog
        open={mode?.kind === "toggle"}
        onOpenChange={(o) => !o && setMode(null)}
        title={
          mode?.kind === "toggle"
            ? `${mode.account.isActive ? "Nyahaktif" : "Aktifkan"} ${mode.account.fullName}?`
            : ""
        }
        description={
          mode?.kind === "toggle" && mode.account.isActive
            ? "Akaun dilog keluar serta-merta dan tidak boleh log masuk sehingga diaktifkan semula."
            : "Akaun boleh log masuk semula dengan kata laluan sedia ada."
        }
        confirmLabel={
          mode?.kind === "toggle" && mode.account.isActive
            ? "Nyahaktif"
            : "Aktifkan"
        }
        destructive={mode?.kind === "toggle" && mode.account.isActive}
        onConfirm={async () => {
          if (mode?.kind !== "toggle") return
          const a = mode.account
          if (a.isActive) await adminApi.staff.deactivate(a.id)
          else await adminApi.staff.activate(a.id)
          await done(
            `${a.fullName} ${a.isActive ? "dinyahaktifkan" : "diaktifkan"}.`
          )
        }}
      />
    </div>
  )
}

function CreateDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (text: string) => Promise<void>
}) {
  const [fullName, setFullName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState<StaffRole | null>(null)
  const [password, setPassword] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!fullName.trim() || !email.trim() || !role) {
      setError("Lengkapkan nama, e-mel dan peranan.")
      return
    }
    if (!meetsPasswordPolicy(password)) {
      setError("Kata laluan sementara belum memenuhi semua syarat.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await adminApi.staff.create({
        fullName: fullName.trim(),
        email: email.trim(),
        role,
        password,
      })
      await onDone(
        `Akaun ${created.fullName} (${STAFF_ROLE[created.role]}) dicipta.`
      )
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title="Akaun staf baharu"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="create-staff" disabled={saving}>
            {saving ? "Mencipta…" : "Cipta akaun"}
          </Button>
        </>
      }
    >
      <form
        id="create-staff"
        onSubmit={save}
        noValidate
        className="flex flex-col gap-4"
      >
        <FormField label="Nama penuh" required>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </FormField>
        <FormField label="E-mel" required>
          <Input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        <FormField
          label="Peranan"
          required
          description={
            role === "KJ" || role === "SUB_UNIT"
              ? "Di luar Unit Integriti: hanya melihat tindakan yang dirujuk kepadanya."
              : undefined
          }
        >
          <StaffRoleSelect value={role} onValueChange={setRole} />
        </FormField>
        <FormField
          label="Kata laluan sementara"
          required
          description="Serahkan secara selamat. Pemilik akaun wajib menukarnya semasa log masuk pertama."
        >
          <PasswordInput
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <PasswordRequirements password={password} />
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}

function RoleDialog({
  account,
  isSelf,
  onClose,
  onDone,
}: {
  account: StaffAccount
  isSelf: boolean
  onClose: () => void
  onDone: (text: string) => Promise<void>
}) {
  const [role, setRole] = React.useState<StaffRole | null>(account.role)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!role || role === account.role) return onClose()
    setSaving(true)
    setError(null)
    try {
      await adminApi.staff.setRole(account.id, role)
      await onDone(`Peranan ${account.fullName} kini ${STAFF_ROLE[role]}.`)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title={`Peranan — ${account.fullName}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button
            type="submit"
            form="staff-role"
            disabled={saving || role === account.role}
          >
            {saving ? "Menyimpan…" : "Simpan peranan"}
          </Button>
        </>
      }
    >
      <form id="staff-role" onSubmit={save} className="flex flex-col gap-4">
        <FormField label="Peranan">
          <StaffRoleSelect value={role} onValueChange={setRole} />
        </FormField>
        {isSelf && role !== "ADMIN" && (
          <Notice tone="warning">
            Anda akan kehilangan akses pentadbir sebaik sahaja disimpan.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}

function PasswordDialog({
  account,
  onClose,
  onDone,
}: {
  account: StaffAccount
  onClose: () => void
  onDone: (text: string) => Promise<void>
}) {
  const [password, setPassword] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!meetsPasswordPolicy(password)) {
      setError("Kata laluan belum memenuhi semua syarat.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await adminApi.staff.resetPassword(account.id, password)
      await onDone(
        `Kata laluan ${account.fullName} diset semula; semua sesinya dilog keluar dan dia perlu menukarnya semasa log masuk seterusnya.`
      )
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title={`Set semula kata laluan — ${account.fullName}`}
      description="Akaun ini dilog keluar dari semua peranti, sekatan dibuka, dan pemilik wajib menukar kata laluan semasa log masuk seterusnya."
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="staff-password" disabled={saving}>
            {saving ? "Menyimpan…" : "Set semula"}
          </Button>
        </>
      }
    >
      <form
        id="staff-password"
        onSubmit={save}
        noValidate
        className="flex flex-col gap-4"
      >
        <FormField label="Kata laluan baharu">
          <PasswordInput
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <PasswordRequirements password={password} />
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}

/** §8 decision 14 (c): the password expiry period, ADMIN's to set. */
function SecuritySettingsCard() {
  const settings = useApiData("security-settings", () =>
    adminApi.settings.security()
  )
  const [days, setDays] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [message, setMessage] = React.useState<{
    tone: "error" | "success"
    text: string
  } | null>(null)

  const current = settings.data?.passwordMaxAgeDays
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (current !== undefined) setDays(String(current))
  }, [current])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const value = Number(days)
    if (!Number.isInteger(value) || value < 1 || value > 3650) {
      setMessage({
        tone: "error",
        text: "Masukkan bilangan hari antara 1 dan 3650.",
      })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const updated = await adminApi.settings.updateSecurity(value)
      settings.setData(updated)
      setMessage({
        tone: "success",
        text: `Tempoh luput kata laluan kini ${updated.passwordMaxAgeDays} hari. Berkuat kuasa pada log masuk seterusnya.`,
      })
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title="Dasar kata laluan"
      description="Kata laluan kakitangan mesti ditukar selepas tempoh ini. Syarat tetap: sekurang-kurangnya 12 aksara dengan huruf besar, huruf kecil, nombor dan aksara khas; 5 cubaan gagal menyekat akaun; log masuk disahkan dengan kod e-mel."
    >
      {settings.status === "error" ? (
        <ErrorState
          error={settings.error}
          onRetry={() => void settings.reload()}
        />
      ) : !settings.data ? (
        <LoadingState />
      ) : (
        <form onSubmit={save} noValidate className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <FormField label="Tempoh luput kata laluan (hari)" className="w-56">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </FormField>
            <Button type="submit" disabled={saving || days === String(current)}>
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Asal: 180 hari (6 bulan).
            {settings.data.updatedByName && (
              <>
                {" "}
                Kali terakhir dikemas kini oleh {
                  settings.data.updatedByName
                },{" "}
                <DateDisplay value={settings.data.updatedAt} kind="datetime" />.
              </>
            )}
          </p>
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
        </form>
      )}
    </Section>
  )
}
