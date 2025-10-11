# Lotion

Lotion is a Notion-inspired note-taking and knowledge management application built with modern web technologies. It provides a connected workspace where users can create, organize, and collaborate on documents.

## Features

- **Document Creation**: Create and manage notes with a clean, intuitive interface
- **Hierarchical Organization**: Organize documents in a folder-like structure
- **Real-time Collaboration**: Built with Convex for real-time data synchronization
- **User Authentication**: Secure authentication with Clerk
- **Trash Management**: Archive and restore documents with full trash functionality
- **Responsive Design**: Works seamlessly across desktop and mobile devices
- **Dark Mode**: Built-in theme support for comfortable viewing

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI, Lucide React Icons
- **Authentication**: Clerk
- **Backend**: Convex (real-time backend-as-a-service)
- **State Management**: Zustand
- **Database**: Convex Database
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js (version 18 or higher)
- pnpm (recommended) or npm/yarn
- A Convex account
- A Clerk account

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd lotion
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment variables:
   Create a `.env.local` file with your Convex and Clerk credentials:
   ```env
   NEXT_PUBLIC_CONVEX_URL=your_convex_url
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
   CLERK_SECRET_KEY=your_clerk_secret_key
   ```

4. Run the development server:
   ```bash
   pnpm dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
app/
  (main)/          # Main application (authenticated users)
    (routes)/       # Document routes
    _components/    # Main layout components
  (marketing)/     # Marketing pages (public)
    _components/    # Marketing page components
components/        # Shared UI components
convex/            # Convex backend functions and schema
hooks/             # Custom React hooks
lib/               # Utility functions
public/            # Static assets
```

## Core Functionality

### Document Management
- Create new documents with the "New Page" button
- Organize documents in a hierarchical structure
- Archive documents to the trash
- Restore documents from the trash
- Permanently delete documents

### Authentication
- Sign up and login with Clerk
- Protected routes for authenticated users only
- User profile management

### Data Model
Documents are stored with the following schema:
- `title`: Document title
- `userId`: Owner of the document
- `isArchived`: Archive status
- `parentDocument`: Parent document ID (for hierarchical organization)
- `content`: Document content (optional)
- `coverImage`: Cover image URL (optional)
- `icon`: Document icon (optional)
- `isPublished`: Publication status (not yet implemented)

## Development

### Available Scripts

- `pnpm dev` - Runs the app in development mode
- `pnpm build` - Builds the app for production
- `pnpm start` - Runs the built app in production mode
- `pnpm lint` - Runs ESLint

### Convex Functions

The backend is powered by Convex with the following functions:
- `documents.create` - Create a new document
- `documents.getSidebar` - Get documents for sidebar display
- `documents.getTrash` - Get archived documents
- `documents.archive` - Archive a document
- `documents.restore` - Restore an archived document
- `documents.remove` - Permanently delete a document
- `documents.getSearch` - Get all documents for search

## Deployment

The easiest way to deploy your Lotion app is to use [Vercel](https://vercel.com/):

1. Push your code to a GitHub repository
2. Create a new project on Vercel
3. Connect your GitHub repository
4. Set up the required environment variables
5. Deploy!

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Learn More

To learn more about the technologies used in this project:

- [Next.js Documentation](https://nextjs.org/docs)
- [Convex Documentation](https://docs.convex.dev/)
- [Clerk Documentation](https://clerk.dev/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

## License

This project is licensed under the MIT License.