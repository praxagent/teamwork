import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardContent } from '@/components/common';
import { useProjects, useDeleteProject, useUpdateProject } from '@/hooks/useApi';
import { ArrowRight, Trash2, AlertTriangle, Plus, ArrowLeft, Pencil, Check, X } from 'lucide-react';
import type { Project } from '@/types';

export function Projects() {
  const navigate = useNavigate();
  const { data: projectsData, isLoading } = useProjects();
  const deleteProject = useDeleteProject();
  const updateProject = useUpdateProject();
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const projects = projectsData?.projects || [];

  const handleEditClick = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProject(project.id);
    setEditName(project.name);
    setEditDescription(project.description || '');
  };

  const handleSaveEdit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editingProject) return;
    
    try {
      await updateProject.mutateAsync({
        projectId: editingProject,
        name: editName,
        description: editDescription,
      });
      setEditingProject(null);
    } catch (error) {
      console.error('Failed to update project:', error);
    }
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProject(null);
  };

  const handleDeleteClick = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setProjectToDelete(project);
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    try {
      await deleteProject.mutateAsync(projectToDelete.id);
      setProjectToDelete(null);
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slack-purple to-purple-900">
      {/* Header */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-white/70 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Home
          </button>
          <Button
            onClick={() => navigate('/new')}
            className="!bg-yellow-400 !text-purple-900 hover:!bg-yellow-300"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        </div>
      </div>

      {/* Projects */}
      <div className="max-w-6xl mx-auto px-4 pb-20">
        <h1 className="text-3xl font-bold text-white mb-8">My Projects</h1>
        
        {isLoading ? (
          <div className="text-center py-20 text-white/60">
            Loading projects...
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-white/60 mb-6">You don't have any projects yet.</p>
            <Button
              onClick={() => navigate('/new')}
              className="!bg-yellow-400 !text-purple-900 hover:!bg-yellow-300"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => {
              const isEditing = editingProject === project.id;
              
              return (
                <Card
                  key={project.id}
                  hoverable={!isEditing}
                  onClick={() => !isEditing && navigate(`/project/${project.id}`)}
                  className={`bg-white/10 border-white/20 group relative ${!isEditing ? 'hover:bg-white/20' : ''}`}
                >
                  <CardContent>
                    {isEditing ? (
                      // Edit mode
                      <div onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full bg-white/20 border border-white/30 rounded px-2 py-1 text-white font-bold text-lg mb-2 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                          placeholder="Project name"
                          autoFocus
                        />
                        <textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          className="w-full bg-white/20 border border-white/30 rounded px-2 py-1 text-white/90 text-sm mb-3 resize-none focus:outline-none focus:ring-2 focus:ring-yellow-400"
                          placeholder="Project description"
                          rows={2}
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={handleCancelEdit}
                            className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-white/70"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleSaveEdit}
                            disabled={updateProject.isPending}
                            className="p-1.5 rounded bg-green-500/80 hover:bg-green-500 text-white"
                            title="Save"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      // View mode
                      <>
                        <div className="flex items-start justify-between">
                          <h3 className="font-bold text-white text-lg mb-1 flex-1">{project.name}</h3>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button
                              onClick={(e) => handleEditClick(project, e)}
                              className="p-1.5 rounded hover:bg-white/20 text-white/70 hover:text-white"
                              title="Edit project"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => handleDeleteClick(project, e)}
                              className="p-1.5 rounded hover:bg-red-500/20 text-white/70 hover:text-red-400"
                              title="Delete project"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <p className="text-white/70 text-sm line-clamp-2 mb-3">
                          {project.description || 'No description'}
                        </p>
                        <div className="flex items-center justify-between text-white/50 text-sm">
                          <span className="capitalize">{project.status}</span>
                          <ArrowRight className="w-4 h-4" />
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {projectToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Delete Project</h3>
                  <p className="text-sm text-gray-500">This action cannot be undone</p>
                </div>
              </div>
              <p className="text-gray-600 mb-4">
                Are you sure you want to delete <span className="font-semibold">{projectToDelete.name}</span>? 
                All project data, messages, and tasks will be permanently removed.
              </p>
            </div>
            <div className="flex gap-3 px-6 py-4 bg-gray-50 justify-end">
              <Button
                variant="ghost"
                onClick={() => setProjectToDelete(null)}
                disabled={deleteProject.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmDelete}
                disabled={deleteProject.isPending}
                className="!bg-red-600 hover:!bg-red-700"
              >
                {deleteProject.isPending ? 'Deleting...' : 'Delete Project'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
