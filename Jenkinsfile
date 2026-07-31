/* ============================================================
 * SMART EVENT MANAGEMENT PORTAL — Jenkinsfile
 * Declarative Pipeline
 *
 * Stages:
 *   1. Checkout
 *   2. Build Backend Image
 *   3. Build Frontend Image
 *   4. Test
 *   5. Docker Push
 *   6. Deploy to Kubernetes
 *   7. Verify Deployment
 * ============================================================ */

pipeline {

    agent any

    /* ── Environment variables ─────────────────────────────── */
    environment {
        DOCKERHUB_USER      = 'soum1602'
        BACKEND_IMAGE       = "${DOCKERHUB_USER}/eventportal-backend"
        FRONTEND_IMAGE      = "${DOCKERHUB_USER}/eventportal-frontend"
        IMAGE_TAG           = 'v1'
        DOCKER_CREDENTIALS  = 'dockerhub-credentials'   // Jenkins credential ID
        KUBECONFIG          = credentials('kubeconfig') // Jenkins file credential for kubeconfig
    }

    options {
        timestamps()                        // prefix every log line with a timestamp
        timeout(time: 20, unit: 'MINUTES') // abort the build if it runs too long
        disableConcurrentBuilds()           // prevent overlapping pipeline runs
    }

    stages {

        /* ── 1. Checkout ───────────────────────────────────── */
        stage('Checkout') {
            steps {
                echo '>>> Checking out source code from GitHub...'
                checkout scm
                echo ">>> Branch: ${env.GIT_BRANCH}  Commit: ${env.GIT_COMMIT?.take(8)}"
            }
        }

        /* ── 2. Build Backend Image ────────────────────────── */
        stage('Build Backend Image') {
            steps {
                echo ">>> Building backend image: ${BACKEND_IMAGE}:${IMAGE_TAG}"
                sh """
                    docker build \
                        --no-cache \
                        -t ${BACKEND_IMAGE}:${IMAGE_TAG} \
                        ./backend
                """
                echo ">>> Backend image built successfully."
            }
        }

        /* ── 3. Build Frontend Image ───────────────────────── */
        stage('Build Frontend Image') {
            steps {
                echo ">>> Building frontend image: ${FRONTEND_IMAGE}:${IMAGE_TAG}"
                sh """
                    docker build \
                        --no-cache \
                        -t ${FRONTEND_IMAGE}:${IMAGE_TAG} \
                        ./frontend
                """
                echo ">>> Frontend image built successfully."
            }
        }

        /* ── 4. Test ───────────────────────────────────────── */
        stage('Test') {
            steps {
                echo '>>> Running smoke tests...'

                // Spin up the backend container on an ephemeral port
                sh """
                    docker rm -f semp-smoke-test 2>/dev/null || true

                    docker run -d \
                        --name semp-smoke-test \
                        -p 5999:5000 \
                        -e FLASK_DEBUG=0 \
                        ${BACKEND_IMAGE}:${IMAGE_TAG}

                    echo "Waiting for backend to start..."
                    sleep 8

                    echo "Hitting /api/health endpoint..."
                    HTTP_STATUS=\$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5999/api/health)

                    docker rm -f semp-smoke-test 2>/dev/null || true

                    if [ "\$HTTP_STATUS" = "200" ]; then
                        echo "Smoke test PASSED — /api/health returned 200."
                    else
                        echo "Smoke test FAILED — /api/health returned HTTP \$HTTP_STATUS"
                        exit 1
                    fi
                """
            }
        }

        /* ── 5. Docker Push ────────────────────────────────── */
        stage('Docker Push') {
            steps {
                echo '>>> Pushing images to Docker Hub...'

                withCredentials([
                    usernamePassword(
                        credentialsId: "${DOCKER_CREDENTIALS}",
                        usernameVariable: 'DOCKER_USER',
                        passwordVariable: 'DOCKER_PASS'
                    )
                ]) {
                    sh """
                        echo \$DOCKER_PASS | docker login -u \$DOCKER_USER --password-stdin

                        docker push ${BACKEND_IMAGE}:${IMAGE_TAG}
                        docker push ${FRONTEND_IMAGE}:${IMAGE_TAG}

                        docker logout
                    """
                }

                echo ">>> Pushed ${BACKEND_IMAGE}:${IMAGE_TAG} and ${FRONTEND_IMAGE}:${IMAGE_TAG}"
            }
        }

        /* ── 6. Deploy to Kubernetes ───────────────────────── */
        stage('Deploy to Kubernetes') {
            steps {
                echo '>>> Applying Kubernetes manifests...'
                sh """
                    kubectl apply -f k8s/
                """
                echo '>>> Manifests applied. Waiting for rollout...'
                sh """
                    kubectl rollout status deployment/backend-deployment  --timeout=90s
                    kubectl rollout status deployment/frontend-deployment --timeout=90s
                """
                echo '>>> Rollout complete.'
            }
        }

        /* ── 7. Verify Deployment ──────────────────────────── */
        stage('Verify Deployment') {
            steps {
                echo '>>> Verifying pod status...'
                sh """
                    echo "\\n=== Pods ==="
                    kubectl get pods -o wide

                    echo "\\n=== Services ==="
                    kubectl get services

                    echo "\\n=== Deployments ==="
                    kubectl get deployments
                """
            }
        }

    } // end stages

    /* ── Post-build actions ────────────────────────────────── */
    post {

        success {
            echo """
            ╔══════════════════════════════════════════════════╗
            ║   ✅  PIPELINE SUCCEEDED                         ║
            ║                                                  ║
            ║   Images pushed:                                 ║
            ║   • ${BACKEND_IMAGE}:${IMAGE_TAG}
            ║   • ${FRONTEND_IMAGE}:${IMAGE_TAG}
            ║                                                  ║
            ║   Deployment live on Kubernetes.                 ║
            ║   Frontend → http://<node-ip>:30080             ║
            ╚══════════════════════════════════════════════════╝
            """
        }

        failure {
            echo """
            ╔══════════════════════════════════════════════════╗
            ║   ❌  PIPELINE FAILED                            ║
            ║                                                  ║
            ║   Check the stage logs above for the error.     ║
            ║   Common causes:                                 ║
            ║   • Docker daemon not running on the agent      ║
            ║   • Invalid dockerhub-credentials in Jenkins    ║
            ║   • kubectl not configured / cluster unreachable║
            ╚══════════════════════════════════════════════════╝
            """
            // Clean up any leftover smoke-test container
            sh 'docker rm -f semp-smoke-test 2>/dev/null || true'
        }

        always {
            echo '>>> Cleaning up local Docker images to free disk space...'
            sh """
                docker rmi ${BACKEND_IMAGE}:${IMAGE_TAG}  2>/dev/null || true
                docker rmi ${FRONTEND_IMAGE}:${IMAGE_TAG} 2>/dev/null || true
            """
        }

    } // end post

} // end pipeline
