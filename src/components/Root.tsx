import {Route, Routes} from "react-router";
import Nav from "../components/Nav";
import Gallery from "../pages/Gallery.tsx";
import Paint from "../pages/Paint";
import Home from "../pages/Home";
import Header from "./Header.tsx";
import GlobalStyle from "./GlobalStyle.tsx";

export default function Root(){
    return(
        <>
            <GlobalStyle />

            <Routes>
                <Route path="/" element={
                    <>
                        <Header/>
                        <Nav />
                        <Home/>
                    </>
                }/>
                <Route path="/paint" element={
                    <>
                        <Nav />
                        <Paint/>
                    </>
                }/>
                <Route path="/gallery" element={
                    <>
                        <Nav />
                        <Gallery/>
                    </>
                }/>
            </Routes>
        </>
    )
}