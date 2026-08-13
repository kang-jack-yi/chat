import { Alert, Button, Form, Input, Modal, Select } from "antd";
import type { Department, User } from "@chat/shared";
import type { OrganizationModalState } from "../hooks";

export interface OrganizationModalProps {
  modal: OrganizationModalState;
  departments: Department[];
  currentUser: User;
  error: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
}

function collectDescendantIds(departmentId: number, departments: Department[]) {
  const ids = new Set<number>([departmentId]);
  let changed = true;
  while (changed) {
    changed = false;
    departments.forEach((department) => {
      if (department.parentId && ids.has(department.parentId) && !ids.has(department.id)) {
        ids.add(department.id);
        changed = true;
      }
    });
  }
  return ids;
}

export default function OrganizationModal({
  modal,
  departments,
  currentUser,
  error,
  pending,
  onClose,
  onSubmit,
}: OrganizationModalProps) {
  const editingDepartment = modal?.kind === "department-edit" ? modal.department : null;
  const excludedIds = editingDepartment
    ? collectDescendantIds(editingDepartment.id, departments)
    : new Set<number>();
  const departmentOptions = departments
    .filter((department) => !excludedIds.has(department.id))
    .map((department) => ({ label: department.name, value: department.id }));
  const isMember = modal?.kind === "member-create";
  const isEdit = modal?.kind === "department-edit";
  const isChild = modal?.kind === "department-create" && modal.asChild;
  const title = isMember ? "添加企业成员" : isEdit ? "编辑部门" : isChild ? "添加子部门" : "新建部门";
  const description = isMember
    ? "创建成员账号并分配所属部门与企业角色"
    : isEdit
      ? "修改部门名称或调整所属上级部门"
      : isChild
        ? "在所选部门下创建一个新的下级部门"
        : "在当前企业组织架构中添加一个新部门";
  const initialValues = isMember
    ? { departmentId: departments[0]?.id, role: "member" }
    : {
        name: editingDepartment?.name,
        parentId: isEdit
          ? editingDepartment?.parentId ?? 0
          : modal?.kind === "department-create"
            ? modal.parentId ?? 0
            : 0,
      };

  return (
    <Modal
      open={Boolean(modal)}
      centered
      width={isMember ? 640 : 520}
      title={title}
      footer={null}
      onCancel={onClose}
      destroyOnHidden
    >
      <p className="mb-5 text-xs text-[#9299a5]">{description}</p>
      <Form
        key={isEdit ? `edit-${editingDepartment?.id}` : `${modal?.kind}-${modal?.kind === "department-create" ? modal.parentId : ""}`}
        layout="vertical"
        onFinish={onSubmit}
        initialValues={initialValues}
      >
        {isMember ? (
          <div className="grid grid-cols-2 gap-x-4 max-sm:grid-cols-1">
            <Form.Item label="姓名" name="name" rules={[{ required: true, message: "请输入姓名" }]}>
              <Input placeholder="请输入真实姓名" />
            </Form.Item>
            <Form.Item label="手机号" name="phone" rules={[{ required: true, message: "请输入手机号" }]}>
              <Input inputMode="numeric" placeholder="11 位手机号" />
            </Form.Item>
            <Form.Item label="登录密码" name="password" rules={[{ required: true, min: 6, message: "密码至少 6 位" }]}>
              <Input.Password placeholder="至少 6 位" />
            </Form.Item>
            <Form.Item label="所属部门" name="departmentId">
              <Select options={departments.map((department) => ({ label: department.name, value: department.id }))} />
            </Form.Item>
            <Form.Item label="职位" name="title">
              <Input placeholder="例如：前端工程师" />
            </Form.Item>
            <Form.Item label="角色" name="role">
              <Select
                options={[
                  { label: "成员", value: "member" },
                  ...(currentUser.role === "owner" ? [{ label: "管理员", value: "admin" }] : []),
                ]}
              />
            </Form.Item>
          </div>
        ) : (
          <>
            <Form.Item label="部门名称" name="name" rules={[{ required: true, message: "请输入部门名称" }]}>
              <Input placeholder="例如：客户成功部" />
            </Form.Item>
            <Form.Item label="上级部门" name="parentId">
              <Select
                options={[
                  { label: "无（设为根部门）", value: 0 },
                  ...departmentOptions,
                ]}
              />
            </Form.Item>
          </>
        )}
        {error && <Alert className="mb-4" type="error" message={error} showIcon />}
        <div className="flex justify-end gap-2 border-t border-[var(--app-line)] pt-5">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" htmlType="submit" loading={pending}>
            {isMember ? "确认添加" : isEdit ? "保存修改" : "确认创建"}
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
