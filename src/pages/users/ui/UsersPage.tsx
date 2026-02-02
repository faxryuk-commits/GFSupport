import { useState } from 'react'
import { Search, Plus, Filter, MoreHorizontal, Mail, Phone, Calendar, Shield, Edit, Trash2, Eye } from 'lucide-react'
import { Modal, ConfirmDialog } from '@/shared/ui'

interface User {
  id: string
  name: string
  email: string
  phone?: string
  company?: string
  avatar?: string
  role: 'customer' | 'vip' | 'partner'
  status: 'active' | 'inactive' | 'blocked'
  casesCount: number
  lastActive: string
  createdAt: string
}

const roleConfig = {
  customer: { label: 'Customer', color: 'bg-slate-100 text-slate-700' },
  vip: { label: 'VIP', color: 'bg-amber-100 text-amber-700' },
  partner: { label: 'Partner', color: 'bg-blue-100 text-blue-700' },
}

const statusConfig = {
  active: { label: 'Active', color: 'bg-green-100 text-green-700' },
  inactive: { label: 'Inactive', color: 'bg-slate-100 text-slate-600' },
  blocked: { label: 'Blocked', color: 'bg-red-100 text-red-700' },
}

const mockUsers: User[] = [
  { id: '1', name: 'John Smith', email: 'john@acmecorp.com', phone: '+1 234 567 8900', company: 'Acme Corp', role: 'vip', status: 'active', casesCount: 12, lastActive: '2 hours ago', createdAt: 'Jan 15, 2024' },
  { id: '2', name: 'Maria Garcia', email: 'maria@techsolutions.io', company: 'TechSolutions', role: 'customer', status: 'active', casesCount: 5, lastActive: '1 day ago', createdAt: 'Feb 20, 2024' },
  { id: '3', name: 'Alex Johnson', email: 'alex@globalfinance.com', phone: '+1 555 123 4567', company: 'Global Finance', role: 'partner', status: 'active', casesCount: 28, lastActive: '5 hours ago', createdAt: 'Dec 1, 2023' },
  { id: '4', name: 'Emma Wilson', email: 'emma@startupxyz.co', company: 'StartupXYZ', role: 'customer', status: 'inactive', casesCount: 2, lastActive: '2 weeks ago', createdAt: 'Mar 10, 2024' },
  { id: '5', name: 'Michael Brown', email: 'michael@enterprise.io', phone: '+1 888 999 0000', company: 'Enterprise Inc', role: 'vip', status: 'blocked', casesCount: 45, lastActive: '1 month ago', createdAt: 'Nov 5, 2023' },
  { id: '6', name: 'Sophie Chen', email: 'sophie@innovate.tech', company: 'Innovate Tech', role: 'customer', status: 'active', casesCount: 8, lastActive: '3 hours ago', createdAt: 'Apr 2, 2024' },
]

export function UsersPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const filteredUsers = mockUsers.filter(user => {
    const matchesSearch = user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         user.company?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesRole = roleFilter === 'all' || user.role === roleFilter
    const matchesStatus = statusFilter === 'all' || user.status === statusFilter
    return matchesSearch && matchesRole && matchesStatus
  })

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Users</h1>
            <p className="text-slate-500 mt-1">Manage your customer database</p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
            <Plus className="w-4 h-4" />
            Add User
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard label="Total Users" value={mockUsers.length} />
          <StatCard label="Active" value={mockUsers.filter(u => u.status === 'active').length} color="text-green-600" />
          <StatCard label="VIP Customers" value={mockUsers.filter(u => u.role === 'vip').length} color="text-amber-600" />
          <StatCard label="Partners" value={mockUsers.filter(u => u.role === 'partner').length} color="text-blue-600" />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all">All Roles</option>
            <option value="customer">Customer</option>
            <option value="vip">VIP</option>
            <option value="partner">Partner</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-6 py-4 text-sm font-medium text-slate-600">User</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-slate-600">Company</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-slate-600">Role</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-slate-600">Status</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-slate-600">Cases</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-slate-600">Last Active</th>
                <th className="text-right px-6 py-4 text-sm font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(user => (
                <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-medium">
                        {user.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">{user.name}</p>
                        <p className="text-sm text-slate-500">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{user.company || '-'}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${roleConfig[user.role].color}`}>
                      {roleConfig[user.role].label}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${statusConfig[user.status].color}`}>
                      {statusConfig[user.status].label}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">{user.casesCount}</td>
                  <td className="px-6 py-4 text-sm text-slate-500">{user.lastActive}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => { setSelectedUser(user); setIsViewModalOpen(true) }}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        <Eye className="w-4 h-4 text-slate-500" />
                      </button>
                      <button 
                        onClick={() => { setSelectedUser(user); setIsEditModalOpen(true) }}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        <Edit className="w-4 h-4 text-slate-500" />
                      </button>
                      <button 
                        onClick={() => { setSelectedUser(user); setIsDeleteDialogOpen(true) }}
                        className="p-2 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* View Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="User Details" size="md">
        {selectedUser && (
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xl font-medium">
                {selectedUser.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-800">{selectedUser.name}</h3>
                <p className="text-slate-500">{selectedUser.company}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <InfoItem icon={Mail} label="Email" value={selectedUser.email} />
              <InfoItem icon={Phone} label="Phone" value={selectedUser.phone || 'Not provided'} />
              <InfoItem icon={Shield} label="Role" value={roleConfig[selectedUser.role].label} />
              <InfoItem icon={Calendar} label="Joined" value={selectedUser.createdAt} />
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-200">
              <button className="flex-1 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-colors">
                View Cases
              </button>
              <button className="flex-1 py-2.5 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors">
                Send Message
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="Edit User" size="md">
        {selectedUser && (
          <form className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
              <input
                type="text"
                defaultValue={selectedUser.name}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                defaultValue={selectedUser.email}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                <select
                  defaultValue={selectedUser.role}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="customer">Customer</option>
                  <option value="vip">VIP</option>
                  <option value="partner">Partner</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <select
                  defaultValue={selectedUser.status}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-6 py-2.5 text-slate-700 font-medium rounded-lg hover:bg-slate-100">Cancel</button>
              <button type="submit" className="px-6 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600">Save Changes</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={() => { setIsDeleteDialogOpen(false); setSelectedUser(null) }}
        title="Delete User"
        message={`Are you sure you want to delete ${selectedUser?.name}? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </>
  )
}

function StatCard({ label, value, color = 'text-slate-800' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  )
}

function InfoItem({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
        <Icon className="w-5 h-5 text-slate-500" />
      </div>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-sm font-medium text-slate-800">{value}</p>
      </div>
    </div>
  )
}
